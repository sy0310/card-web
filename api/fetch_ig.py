from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import traceback
from instagrapi import Client

# Load local .env.local values as fallback for development
try:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scripts_dir = os.path.join(base_dir, 'src', 'scripts')
    if os.path.exists(scripts_dir):
        sys.path.append(scripts_dir)
        from publish_ig_env import load_publish_env
        env = load_publish_env(os.path.join(base_dir, '.env.local'))
        for k, v in env.items():
            k_clean = k.strip()
            # Don't overwrite existing environment variables
            if k_clean and not os.environ.get(k_clean):
                os.environ[k_clean] = v.strip()
except Exception as e:
    # Fail silently, e.g. when running in Vercel production
    pass

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # 1. Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            media_code = data.get('mediaCode')
            if not media_code:
                self._send_json({'error': 'Missing mediaCode'}, 400)
                return
            
            # 2. Get credentials from environment
            session_id = os.environ.get('session_id')
            proxy = os.environ.get('proxy')
            
            if not session_id:
                self._send_json({'error': 'session_id not configured in environment'}, 500)
                return
            
            # 3. Setup instagrapi client
            cl = Client()
            cl.request_timeout = 20
            
            if proxy:
                cl.set_proxy(proxy)
            
            # 4. Login
            cl.login_by_sessionid(session_id)
            
            # 5. Fetch media info
            media_pk = cl.media_pk_from_code(media_code)
            media = cl.media_info(media_pk)
            
            # 6. Extract image URL
            image_url = None
            if media.media_type == 1:  # Photo
                image_url = media.thumbnail_url
            elif media.media_type == 8:  # Album (Carousel)
                image_url = media.resources[0].thumbnail_url if media.resources else media.thumbnail_url
            else:
                image_url = media.thumbnail_url
                
            if not image_url:
                self._send_json({'error': 'No valid image URL found on the Instagram post'}, 500)
                return
                
            # 7. Success response
            res_data = {
                'success': True,
                'caption': media.caption_text or "",
                'imageUrl': image_url
            }
            self._send_json(res_data, 200)
            
        except Exception as e:
            error_detail = f"{str(e)}\n\nTraceback:\n{traceback.format_exc()}"
            self._send_json({'error': error_detail}, 500)

    def _send_json(self, data, status_code):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
