package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// Configuration
type Config struct {
	BotToken         string
	BackupChannelID  int64
	APIKey           string
	Port             string
	CookiesFile      string
}

// Request types
type ProcessRequest struct {
	URL        string `json:"url"`
	CustomName string `json:"customName,omitempty"`
	UserID     int64  `json:"userId"`
	ChatID     int64  `json:"chatId"`
}

type DownloadResult struct {
	FilePath string
	FileName string
	FileSize int64
}

var (
	config Config
	bot    *tgbotapi.BotAPI
)

func init() {
	config = Config{
		BotToken:        getEnv("BOT_TOKEN", ""),
		BackupChannelID: getEnvInt64("BACKUP_CHANNEL_ID", 0),
		APIKey:          getEnv("KOYEB_API_KEY", ""),
		Port:            getEnv("PORT", "3000"),
		CookiesFile:     getEnv("COOKIES_FILE", "/app/cookies.txt"),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if value := os.Getenv(key); value != "" {
		var result int64
		fmt.Sscanf(value, "%d", &result)
		return result
	}
	return fallback
}

func main() {
	// Initialize bot
	var err error
	bot, err = tgbotapi.NewBotAPI(config.BotToken)
	if err != nil {
		log.Fatal("Failed to create bot:", err)
	}

	log.Printf("🤖 Bot authorized as @%s", bot.Self.UserName)

	// Setup HTTP server
	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/process", authMiddleware(processHandler))

	addr := ":" + config.Port
	log.Printf("🚀 Server starting on %s", addr)
	
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal("Server failed:", err)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "ok",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token != config.APIKey {
			http.Error(w, "Invalid API key", http.StatusUnauthorized)
			return
		}

		next(w, r)
	}
}

func processHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ProcessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Respond immediately
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "processing",
		"message": "File processing started",
	})

	// Process asynchronously
	go processFile(req)
}

func processFile(req ProcessRequest) {
	ctx := context.Background()
	
	// Send progress message
	msg := tgbotapi.NewMessage(req.ChatID, "🔄 در حال دانلود...")
	progressMsg, err := bot.Send(msg)
	if err != nil {
		log.Printf("Failed to send progress message: %v", err)
		return
	}

	defer func() {
		if r := recover(); r != nil {
			errorMsg := fmt.Sprintf("❌ خطای غیرمنتظره: %v", r)
			sendMessage(req.ChatID, errorMsg)
		}
	}()

	// Determine platform and download
	platform := getPlatformType(req.URL)
	log.Printf("Processing %s URL for user %d", platform, req.UserID)

	var result *DownloadResult
	var err error

	switch platform {
	case "youtube":
		result, err = downloadFromYouTube(ctx, req.URL, req.CustomName)
	case "spotify", "deezer", "soundcloud", "adult":
		result, err = downloadWithYtDlp(ctx, req.URL, req.CustomName, platform)
	default:
		result, err = downloadDirectFile(ctx, req.URL, req.CustomName)
	}

	if err != nil {
		log.Printf("Download failed: %v", err)
		editMessage(req.ChatID, progressMsg.MessageID, fmt.Sprintf("❌ خطا در دانلود: %v", err))
		return
	}

	// Upload to Telegram
	editMessage(req.ChatID, progressMsg.MessageID, "📤 در حال آپلود...")

	if err := uploadToTelegram(result, req.ChatID, req.URL); err != nil {
		log.Printf("Upload failed: %v", err)
		sendMessage(req.ChatID, fmt.Sprintf("❌ خطا در آپلود: %v", err))
		return
	}

	// Cleanup
	os.Remove(result.FilePath)
	bot.Request(tgbotapi.NewDeleteMessage(req.ChatID, progressMsg.MessageID))
	
	sendMessage(req.ChatID, "✅ فایل با موفقیت آپلود شد!")
}

func getPlatformType(url string) string {
	urlLower := strings.ToLower(url)
	
	if strings.Contains(urlLower, "youtube.com") || strings.Contains(urlLower, "youtu.be") {
		return "youtube"
	}
	if strings.Contains(urlLower, "spotify.com") {
		return "spotify"
	}
	if strings.Contains(urlLower, "deezer.com") {
		return "deezer"
	}
	if strings.Contains(urlLower, "soundcloud.com") {
		return "soundcloud"
	}
	if strings.Contains(urlLower, "pornhub.com") || strings.Contains(urlLower, "xvideos.com") {
		return "adult"
	}
	
	return "direct"
}

func downloadFromYouTube(ctx context.Context, url, customName string) (*DownloadResult, error) {
	filePath := generateTempPath(".mp3")
	
	cmd := exec.CommandContext(ctx, "yt-dlp",
		"--extract-audio",
		"--audio-format", "mp3",
		"--cookies", config.CookiesFile,
		"-o", filePath,
		url,
	)
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp failed: %s", output)
	}

	fileName := customName
	if fileName == "" {
		fileName = filepath.Base(filePath)
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}

	return &DownloadResult{
		FilePath: filePath,
		FileName: fileName,
		FileSize: stat.Size(),
	}, nil
}

func downloadWithYtDlp(ctx context.Context, url, customName, platform string) (*DownloadResult, error) {
	filePath := generateTempPath("")
	
	args := []string{
		"--cookies", config.CookiesFile,
		"-f", "best",
		"-o", filePath,
		url,
	}

	if platform == "spotify" || platform == "deezer" || platform == "soundcloud" {
		args = append([]string{"--extract-audio", "--audio-format", "mp3"}, args...)
	}

	cmd := exec.CommandContext(ctx, "yt-dlp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("yt-dlp failed: %s", output)
	}

	// Find the actual downloaded file
	files, err := filepath.Glob(filePath + "*")
	if err != nil || len(files) == 0 {
		return nil, fmt.Errorf("downloaded file not found")
	}

	actualFile := files[0]
	fileName := customName
	if fileName == "" {
		fileName = filepath.Base(actualFile)
	}

	stat, err := os.Stat(actualFile)
	if err != nil {
		return nil, err
	}

	return &DownloadResult{
		FilePath: actualFile,
		FileName: fileName,
		FileSize: stat.Size(),
	}, nil
}

func downloadDirectFile(ctx context.Context, url, customName string) (*DownloadResult, error) {
	client := &http.Client{Timeout: 10 * time.Minute}
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	ext := filepath.Ext(url)
	if ext == "" {
		ext = ".bin"
	}

	filePath := generateTempPath(ext)
	file, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	written, err := io.Copy(file, resp.Body)
	if err != nil {
		return nil, err
	}

	fileName := customName
	if fileName == "" {
		fileName = filepath.Base(url)
		if fileName == "" {
			fileName = "file" + ext
		}
	}

	return &DownloadResult{
		FilePath: filePath,
		FileName: fileName,
		FileSize: written,
	}, nil
}

func uploadToTelegram(result *DownloadResult, chatID int64, sourceURL string) error {
	// Upload to backup channel first
	backupMsg := tgbotapi.NewDocument(config.BackupChannelID, tgbotapi.FilePath(result.FilePath))
	backupMsg.Caption = fmt.Sprintf("🔗 Source: %s\n📅 %s", sourceURL, time.Now().Format(time.RFC3339))
	
	sent, err := bot.Send(backupMsg)
	if err != nil {
		return fmt.Errorf("backup upload failed: %w", err)
	}

	if sent.Document == nil {
		return fmt.Errorf("no document in backup message")
	}

	// Send to user
	userMsg := tgbotapi.NewDocument(chatID, tgbotapi.FileID(sent.Document.FileID))
	_, err = bot.Send(userMsg)
	
	return err
}

func generateTempPath(ext string) string {
	b := make([]byte, 16)
	rand.Read(b)
	name := hex.EncodeToString(b) + ext
	return filepath.Join("/tmp", name)
}

func sendMessage(chatID int64, text string) {
	msg := tgbotapi.NewMessage(chatID, text)
	bot.Send(msg)
}

func editMessage(chatID int64, messageID int, text string) {
	edit := tgbotapi.NewEditMessageText(chatID, messageID, text)
	bot.Send(edit)
}
