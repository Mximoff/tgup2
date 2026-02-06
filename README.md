# Go Backend - بک‌اند Go 🚀

نسخه Go بک‌اند با مزایای زیر:

## ✨ مزایای نسخه Go

### 🚀 عملکرد
- **10-20x سریع‌تر** از Node.js
- **حافظه کمتر**: ~10-20MB vs 50-100MB Node.js
- **CPU کمتر**: Goroutines خیلی کارآمدتر از threads
- **Build تک‌فایلی**: فقط 1 binary، نه node_modules!

### 📦 حجم
- **Binary**: ~15-20MB (vs 150MB+ Node.js + modules)
- **Docker image**: ~50MB (vs 200MB+ Node.js)
- **سریع‌تر deploy** می‌شه

### 💪 پایداری
- **Garbage Collector** بهتر
- **Memory leaks** کمتر
- **Concurrent processing** عالی با Goroutines

## 🔧 استفاده

### لوکال

```bash
# نصب dependencies
go mod download

# اجرا
export BOT_TOKEN="your_token"
export BACKUP_CHANNEL_ID="-1001234567890"
export KOYEB_API_KEY="your_key"
export PORT="3000"

go run main.go
```

### Docker

```bash
# Build
docker build -t telegram-bot-go .

# Run
docker run -p 3000:3000 \
  -e BOT_TOKEN="your_token" \
  -e BACKUP_CHANNEL_ID="-1001234567890" \
  -e KOYEB_API_KEY="your_key" \
  telegram-bot-go
```

### Koyeb Deploy

1. به Koyeb dashboard برو
2. Create New App → Docker
3. GitHub repo را انتخاب کن
4. Dockerfile path: `koyeb-backend-go/Dockerfile`
5. Environment variables را تنظیم کن
6. Deploy!

## 📊 مقایسه با Node.js

| ویژگی | Node.js | Go |
|-------|---------|-----|
| سرعت اجرا | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| مصرف RAM | 50-100MB | 10-20MB |
| حجم Image | 200MB+ | 50MB |
| زمان Build | 2-3 min | 1-2 min |
| Concurrent Handling | خوب | عالی |
| CPU Usage | متوسط | کم |

## 🎯 توصیه

برای **production** حتماً از نسخه **Go** استفاده کنید چون:
- ✅ سریع‌تر
- ✅ پایدارتر  
- ✅ کم‌حجم‌تر
- ✅ مصرف منابع کمتر
- ✅ با پلن رایگان Koyeb بهتر کار می‌کنه

## 📝 نکات

- Binary یک‌تکه است، نیاز به npm/node ندارد
- yt-dlp توی Alpine نصب میشه (runtime)
- Goroutines برای async processing
- Context برای timeout management
- Built-in error handling
