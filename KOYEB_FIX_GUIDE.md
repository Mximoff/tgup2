# راهنمای رفع مشکل Build در Koyeb

## مشکل
خطای زیر هنگام build در Koyeb:
```
error: failed to solve: process "/bin/sh -c CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ." did not complete successfully: exit code: 1
```

## علت اصلی
فایل `go.sum` خالی بود که باعث می‌شد Go نتواند dependencies را به درستی دانلود و verify کند.

## راه‌حل

### مرحله 1: اصلاح go.sum
فایل `go.sum` را با محتوای زیر جایگزین کنید:

```
github.com/go-telegram-bot-api/telegram-bot-api/v5 v5.5.1 h1:wG8n/XJQ07TmjbITcGiUaOtXxdrINDz1b0J1w0SzqDc=
github.com/go-telegram-bot-api/telegram-bot-api/v5 v5.5.1/go.mod h1:A2S0CWkNylc2phvKXWBBdD3K0iGnDBGbzRpISP2zBl8=
```

### مرحله 2: استفاده از Dockerfile بهبود یافته
می‌توانید از `Dockerfile.fixed` که شامل بهبودهای زیر است استفاده کنید:

**بهبودها:**
1. ✅ اضافه شدن `go mod verify` برای اطمینان از صحت dependencies
2. ✅ فلگ `-v` برای خروجی verbose در حین build
3. ✅ بررسی وجود binary بعد از build
4. ✅ نصب `ca-certificates` در مرحله build
5. ✅ بررسی وجود و صلاحیت اجرایی binary در runtime

**نحوه استفاده:**
```bash
# تغییر نام فایل (در دایرکتوری پروژه)
mv Dockerfile Dockerfile.old
mv Dockerfile.fixed Dockerfile
```

یا در Koyeb مسیر Dockerfile را به `Dockerfile.fixed` تغییر دهید.

### مرحله 3: تست محلی (اختیاری)
قبل از push به Koyeb، می‌توانید محلی تست کنید:

```bash
cd koyeb-backend-go

# ساخت image
docker build -t telegram-bot-test .

# اجرای container (برای تست)
docker run -e BOT_TOKEN=your_token \
           -e BACKUP_CHANNEL_ID=your_channel_id \
           -e KOYEB_API_KEY=your_api_key \
           -p 3000:3000 \
           telegram-bot-test
```

### مرحله 4: متغیرهای محیطی مورد نیاز در Koyeb

مطمئن شوید این متغیرها در Koyeb تنظیم شده‌اند:

```
BOT_TOKEN=your_telegram_bot_token
BACKUP_CHANNEL_ID=your_backup_channel_id
KOYEB_API_KEY=your_api_key
PORT=3000  # یا هر port دیگری که Koyeb تعیین کرده
COOKIES_FILE=/app/cookies.txt  # (اختیاری)
```

### مرحله 5: بررسی logs در Koyeb

بعد از deploy، logs را بررسی کنید:
- باید پیام `🤖 Bot authorized as @botname` را ببینید
- باید پیام `🚀 Server starting on :3000` را ببینید
- endpoint `/health` باید با status code 200 پاسخ دهد

## نکات مهم

### حجم فایل‌ها
- Koyeb محدودیت حجم دارد (معمولاً 2GB)
- فایل‌های دانلود شده در `/tmp` ذخیره می‌شوند
- بعد از آپلود به تلگرام، فایل‌ها حذف می‌شوند

### محدودیت‌های حافظه
اگر با خطای Out of Memory مواجه شدید:
1. حجم instance را در Koyeb افزایش دهید
2. timeout دانلود را کاهش دهید
3. حجم فایل‌های قابل دانلود را محدود کنید

### امنیت
- `KOYEB_API_KEY` را به صورت محرمانه در Koyeb تنظیم کنید
- از secrets استفاده کنید نه environment variables عادی
- `BOT_TOKEN` را هرگز commit نکنید

## تست عملکرد

### تست health endpoint
```bash
curl https://your-app.koyeb.app/health
```

پاسخ باید شبیه این باشد:
```json
{
  "status": "ok",
  "timestamp": "2025-02-07T12:34:56Z"
}
```

### تست process endpoint
```bash
curl -X POST https://your-app.koyeb.app/process \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "userId": 123456,
    "chatId": 123456
  }'
```

## پلتفرم‌های پشتیبانی شده
- ✅ YouTube (دانلود صوتی MP3)
- ✅ Spotify
- ✅ Deezer
- ✅ SoundCloud
- ✅ لینک‌های مستقیم فایل
- ✅ سایت‌های ویدیویی با پشتیبانی yt-dlp

## عیب‌یابی اضافی

### خطای "yt-dlp failed"
- مطمئن شوید yt-dlp نصب است (در Dockerfile هست)
- فایل cookies.txt را بررسی کنید
- URL را تست کنید

### خطای "backup upload failed"
- BACKUP_CHANNEL_ID را بررسی کنید
- مطمئن شوید bot در کانال admin است
- دسترسی‌های bot را بررسی کنید

### خطای "Unauthorized"
- KOYEB_API_KEY را بررسی کنید
- header Authorization را بررسی کنید
- فرمت: `Authorization: Bearer YOUR_KEY`

## لینک‌های مفید
- [Koyeb Documentation](https://www.koyeb.com/docs)
- [Go Telegram Bot API](https://github.com/go-telegram-bot-api/telegram-bot-api)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)

---

**نکته:** این نسخه Go بهینه‌تر و سبک‌تر از نسخه Node.js است و مصرف حافظه کمتری دارد.
