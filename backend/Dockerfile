FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /africgreen-api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -o /africgreen-scraper ./cmd/scraper

FROM alpine:3.20
RUN apk --no-cache add ca-certificates
COPY --from=builder /africgreen-api /africgreen-api
COPY --from=builder /africgreen-scraper /africgreen-scraper
# Equasis fixture HTML — used by EQUASIS_FETCHER=fixture (default in v0).
# The scraper reads from /testdata/equasis/<imo>.html. Real HTTP fetcher needs
# legal sign-off — see cmd/scraper/main.go.
COPY testdata /testdata

EXPOSE 8080
CMD ["/africgreen-api"]
