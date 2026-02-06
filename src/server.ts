import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import ytdl from 'ytdl-core';
import spotifyDl from 'spotify-downloader';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const BACKUP_CHANNEL_ID = process.env.BACKUP_CHANNEL_ID!;
const API_KEY = process.env.KOYEB_API_KEY!;
const COOKIES_FILE = process.env.COOKIES_FILE || '/app/cookies.txt';

const bot = new Telegraf(BOT_TOKEN);

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// Types
interface ProcessRequest {
  url: string;
  customName?: string;
  userId: number;
  chatId: number;
}

interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
}

// Helper functions
function generateTempPath(extension: string = ''): string {
  const randomName = crypto.randomBytes(16).toString('hex');
  return path.join('/tmp', `${randomName}${extension}`);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._\-]/g, '_');
}

async function ensureTmpDir(): Promise<void> {
  try {
    await mkdir('/tmp', { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

function getPlatformType(url: string): string {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'youtube';
  }
  if (urlLower.includes('spotify.com')) {
    return 'spotify';
  }
  if (urlLower.includes('deezer.com')) {
    return 'deezer';
  }
  if (urlLower.includes('soundcloud.com')) {
    return 'soundcloud';
  }
  if (urlLower.includes('pornhub.com') || urlLower.includes('redtube.com') || urlLower.includes('xvideos.com')) {
    return 'adult';
  }
  
  return 'direct';
}

async function downloadFromYouTube(url: string, customName?: string): Promise<DownloadResult> {
  try {
    const info = await ytdl.getInfo(url);
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    
    const fileName = customName || sanitizeFileName(info.videoDetails.title) + '.mp3';
    const filePath = generateTempPath('.mp3');
    
    return new Promise((resolve, reject) => {
      const stream = ytdl(url, { format });
      const writeStream = fs.createWriteStream(filePath);
      
      stream.pipe(writeStream);
      
      writeStream.on('finish', () => {
        const stats = fs.statSync(filePath);
        resolve({
          filePath,
          fileName,
          fileSize: stats.size
        });
      });
      
      writeStream.on('error', reject);
      stream.on('error', reject);
    });
  } catch (error) {
    throw new Error(`YouTube download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function downloadFromSpotify(url: string, customName?: string): Promise<DownloadResult> {
  try {
    const data = await spotifyDl.getDetails(url);
    const filePath = generateTempPath('.mp3');
    
    await spotifyDl.download(url, filePath);
    
    const fileName = customName || sanitizeFileName(data.title) + '.mp3';
    const stats = fs.statSync(filePath);
    
    return {
      filePath,
      fileName,
      fileSize: stats.size
    };
  } catch (error) {
    throw new Error(`Spotify download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function downloadWithYtDlp(url: string, customName?: string, platform: string): Promise<DownloadResult> {
  const { spawn } = require('child_process');
  const outputTemplate = generateTempPath();
  
  return new Promise((resolve, reject) => {
    const args = [
      '--cookies', COOKIES_FILE,
      '-f', 'best',
      '-o', outputTemplate,
      url
    ];
    
    // Add platform-specific options
    if (platform === 'deezer') {
      args.unshift('--extract-audio', '--audio-format', 'mp3');
    }
    
    const ytDlp = spawn('yt-dlp', args);
    
    let stderr = '';
    
    ytDlp.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    ytDlp.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr}`));
        return;
      }
      
      try {
        const files = fs.readdirSync('/tmp').filter(f => f.startsWith(path.basename(outputTemplate)));
        
        if (files.length === 0) {
          reject(new Error('Downloaded file not found'));
          return;
        }
        
        const actualFile = path.join('/tmp', files[0]);
        const stats = fs.statSync(actualFile);
        const extension = path.extname(actualFile);
        const fileName = customName || sanitizeFileName(path.basename(url)) + extension;
        
        resolve({
          filePath: actualFile,
          fileName,
          fileSize: stats.size
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function downloadDirectFile(url: string, customName?: string): Promise<DownloadResult> {
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 600000, // 10 minutes
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    const contentType = response.headers['content-type'] || '';
    const extension = path.extname(url) || guessExtensionFromContentType(contentType);
    
    const fileName = customName || sanitizeFileName(path.basename(url)) || `file${extension}`;
    const filePath = generateTempPath(extension);
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        const stats = fs.statSync(filePath);
        resolve({
          filePath,
          fileName,
          fileSize: stats.size
        });
      });
      
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (error) {
    throw new Error(`Direct download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function guessExtensionFromContentType(contentType: string): string {
  const typeMap: { [key: string]: string } = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/zip': '.zip'
  };
  
  return typeMap[contentType] || '';
}

async function uploadToTelegram(
  filePath: string,
  fileName: string,
  chatId: number,
  originalUrl: string
): Promise<string> {
  try {
    // Upload to backup channel
    const backupMessage = await bot.telegram.sendDocument(BACKUP_CHANNEL_ID, {
      source: filePath,
      filename: fileName
    }, {
      caption: `🔗 Source: ${originalUrl}\n📅 ${new Date().toISOString()}`
    });
    
    const fileId = backupMessage.document?.file_id;
    
    if (!fileId) {
      throw new Error('Failed to get file_id from backup upload');
    }
    
    // Send to user
    await bot.telegram.sendDocument(chatId, fileId);
    
    return fileId;
    
  } catch (error) {
    throw new Error(`Telegram upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function splitAndUpload(
  filePath: string,
  fileName: string,
  chatId: number,
  originalUrl: string,
  maxPartSize: number = 50 * 1024 * 1024
): Promise<void> {
  const stats = fs.statSync(filePath);
  const totalSize = stats.size;
  const numParts = Math.ceil(totalSize / maxPartSize);
  
  if (numParts === 1) {
    await uploadToTelegram(filePath, fileName, chatId, originalUrl);
    return;
  }
  
  // Notify user about splitting
  await bot.telegram.sendMessage(chatId, `📦 فایل به ${numParts} قسمت تقسیم می‌شود...`);
  
  const readStream = fs.createReadStream(filePath, { highWaterMark: maxPartSize });
  let partNumber = 1;
  
  for await (const chunk of readStream) {
    const partPath = generateTempPath(path.extname(fileName));
    await writeFile(partPath, chunk);
    
    const partFileName = `${path.parse(fileName).name}.part${partNumber}${path.extname(fileName)}`;
    
    await uploadToTelegram(partPath, partFileName, chatId, originalUrl);
    await unlink(partPath);
    
    partNumber++;
  }
}

// Middleware: API Key authentication
function authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid API key' });
    return;
  }
  
  const token = authHeader.substring(7);
  
  if (token !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    return;
  }
  
  next();
}

// Routes
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/process', authenticateApiKey, async (req: Request, res: Response) => {
  const { url, customName, userId, chatId }: ProcessRequest = req.body;
  
  if (!url || !userId || !chatId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  
  // Respond immediately to avoid timeout
  res.status(202).json({ 
    status: 'processing', 
    message: 'File processing started' 
  });
  
  // Process asynchronously
  (async () => {
    let filePath: string | null = null;
    
    try {
      await ensureTmpDir();
      
      const platform = getPlatformType(url);
      let result: DownloadResult;
      
      await bot.telegram.sendMessage(chatId, `🔄 در حال دانلود از ${platform}...`);
      
      switch (platform) {
        case 'youtube':
          result = await downloadFromYouTube(url, customName);
          break;
          
        case 'spotify':
          result = await downloadFromSpotify(url, customName);
          break;
          
        case 'deezer':
        case 'soundcloud':
        case 'adult':
          result = await downloadWithYtDlp(url, customName, platform);
          break;
          
        case 'direct':
        default:
          result = await downloadDirectFile(url, customName);
          break;
      }
      
      filePath = result.filePath;
      
      await bot.telegram.sendMessage(chatId, '📤 در حال آپلود...');
      
      // Split if necessary
      if (result.fileSize > 50 * 1024 * 1024) {
        await splitAndUpload(result.filePath, result.fileName, chatId, url);
      } else {
        await uploadToTelegram(result.filePath, result.fileName, chatId, url);
      }
      
      await bot.telegram.sendMessage(chatId, '✅ فایل با موفقیت آپلود شد!');
      
    } catch (error) {
      console.error('Processing error:', error);
      
      await bot.telegram.sendMessage(
        chatId,
        `❌ خطا در پردازش:\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
    } finally {
      // Cleanup
      if (filePath) {
        try {
          await unlink(filePath);
        } catch (error) {
          console.error('Cleanup error:', error);
        }
      }
    }
  })();
});

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: error.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Koyeb backend running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
