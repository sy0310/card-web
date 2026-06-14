from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import tempfile
import sys

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
        temp_path = None
        try:
            # 1. Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            image_url = data.get('imageUrl')
            caption = data.get('caption')
            
            if not image_url or not caption:
                self._send_json({'error': 'Missing imageUrl or caption'}, 400)
                return
            
            # 2. Get credentials from environment
            session_id = os.environ.get('session_id')
            proxy = os.environ.get('proxy')
            
            if not session_id:
                self._send_json({'error': 'session_id not configured in environment'}, 500)
                return

            try:
                from instagrapi import Client
            except Exception as import_error:
                self._send_json({'error': f'Instagram publisher dependency is not available: {import_error}'}, 500)
                return
            
            # 3. Setup instagrapi client
            cl = Client()
            cl.request_timeout = 20
            
            if proxy:
                cl.set_proxy(proxy)
            
            # 4. Login
            cl.login_by_sessionid(session_id)
            
            # 5. Download image to temporary file
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as temp_file:
                temp_path = temp_file.name
            
            # We fetch the image using urllib
            req = urllib.request.Request(
                image_url, 
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req) as response:
                with open(temp_path, 'wb') as out_file:
                    out_file.write(response.read())
            
            # 6. Upload photo to Instagram
            media = cl.photo_upload(temp_path, caption)
            
            # 7. Success response
            res_data = {
                'success': True,
                'media_code': media.code,
                'pk': str(media.pk),
                'url': f'https://www.instagram.com/p/{media.code}/'
            }
            self._send_json(res_data, 200)
            
        except Exception as e:
            self._send_json({'error': str(e)}, 500)
        finally:
            # Cleanup temp file
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    def _send_json(self, data, status_code):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        # Access-Control-Allow-Origin for local cross-origin development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
