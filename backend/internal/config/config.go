package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port            string
	SupabaseURL     string
	SupabaseKey     string // service_role key
	AISStreamAPIKey string
	APISecret       string // internal API auth
	AllowedOrigins  []string
}

func Load() *Config {
	_ = godotenv.Load() // optional .env file

	origins := []string{"http://localhost:3300"}
	if appURL := os.Getenv("APP_URL"); appURL != "" {
		origins = append(origins, appURL)
	}

	return &Config{
		Port:            getEnv("PORT", "8080"),
		SupabaseURL:     os.Getenv("SUPABASE_URL"),
		SupabaseKey:     os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		AISStreamAPIKey: os.Getenv("AISSTREAM_API_KEY"),
		APISecret:       os.Getenv("API_SECRET"),
		AllowedOrigins:  origins,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
