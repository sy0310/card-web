import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the request using Supabase auth user token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized: Missing Auth Header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: `Unauthorized: ${authError?.message || 'Invalid token'}` }, { status: 401 });
    }

    // 2. Parse request payload
    const { imageUrl, caption, cardId } = await request.json();
    if (!imageUrl || !caption) {
      return NextResponse.json({ error: 'Missing imageUrl or caption' }, { status: 400 });
    }

    // 3. Download the image to a temporary file
    let tempFilePath = '';
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        throw new Error(`Failed to fetch image from URL: ${imgRes.statusText}`);
      }
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      tempFilePath = path.join(os.tmpdir(), `ig-${Date.now()}.jpg`);
      fs.writeFileSync(tempFilePath, buffer);
    } catch (downloadErr: unknown) {
      const errMsg = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
      return NextResponse.json({ error: `Failed to download image locally: ${errMsg}` }, { status: 500 });
    }

    // 4. Run publish-ig.py python script
    const scriptPath = path.join(process.cwd(), 'src/scripts/publish-ig.py');
    
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('python3', [scriptPath, tempFilePath, caption], (error, stdout, stderr) => {
        // Cleanup temp file immediately
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (cleanupErr) {
          console.error('Error cleaning up temp file:', cleanupErr);
        }

        if (error) {
          return reject(new Error(stderr || error.message || 'Python process error'));
        }
        resolve(stdout);
      });
    });

    // 5. Parse Python result
    const lines = stdout.split('\n');
    let result: { success: boolean; media_code: string; pk: string; url: string } | null = null;
    
    for (const line of lines) {
      if (line.startsWith('RESULT_JSON:')) {
        try {
          result = JSON.parse(line.substring(12));
        } catch (e) {
          console.error('Failed to parse JSON result from python stdout:', e);
        }
        break;
      }
    }

    if (!result || !result.success) {
      return NextResponse.json({ error: 'Publishing script did not return success json', stdout }, { status: 500 });
    }

    // 6. Update card original_ig_url in the database if cardId is provided
    if (cardId) {
      const { error: dbError } = await supabaseAdmin
        .from('cards')
        .update({ original_ig_url: result.url })
        .eq('id', cardId);
      if (dbError) {
        console.error('Failed to update card database with IG URL:', dbError.message);
      }
    }

    return NextResponse.json({ success: true, url: result.url });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg || 'Internal Server Error' }, { status: 500 });
  }
}
