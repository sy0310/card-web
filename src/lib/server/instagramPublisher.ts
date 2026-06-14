import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type InstagramPublishResult = {
  success: true;
  media_code: string;
  pk: string;
  url: string;
};

type InstagramPublishWithOutput = InstagramPublishResult & {
  stdout: string;
};

export function parseInstagramPublishResult(stdout: string): InstagramPublishResult | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('RESULT_JSON:')) continue;

    try {
      const parsed = JSON.parse(line.substring('RESULT_JSON:'.length));
      if (!parsed?.success || typeof parsed.url !== 'string') return null;

      return {
        success: true,
        media_code: String(parsed.media_code ?? ''),
        pk: String(parsed.pk ?? ''),
        url: parsed.url,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function imageExtensionFromContentType(contentType: string | null) {
  const normalized = contentType?.toLowerCase().split(';')[0].trim();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return 'jpg';
}

async function runPublishScript(scriptPath: string, imagePath: string, caption: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'python3',
      [scriptPath, imagePath, caption],
      {
        cwd: process.cwd(),
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 2,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message || 'Python process error'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function publishInstagramPost({
  imageUrl,
  caption,
}: {
  imageUrl: string;
  caption: string;
}): Promise<InstagramPublishWithOutput> {
  if (!imageUrl) {
    throw new Error('Missing imageUrl.');
  }
  if (!caption.trim()) {
    throw new Error('Missing Instagram caption.');
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image from URL: ${imageResponse.statusText}`);
  }

  const extension = imageExtensionFromContentType(imageResponse.headers.get('content-type'));
  const tempFilePath = path.join(os.tmpdir(), `ig-${Date.now()}-${randomUUID()}.${extension}`);

  try {
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    await fs.writeFile(tempFilePath, buffer);

    const scriptPath = path.join(process.cwd(), 'src/scripts/publish-ig.py');
    const stdout = await runPublishScript(scriptPath, tempFilePath, caption);
    const result = parseInstagramPublishResult(stdout);

    if (!result) {
      throw new Error(`Publishing script did not return success json. ${stdout}`);
    }

    return { ...result, stdout };
  } finally {
    await fs.unlink(tempFilePath).catch(() => undefined);
  }
}
