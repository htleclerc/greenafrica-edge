FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /africgreen-api ./cmd/api

FROM alpine:3.20
RUN apk --no-cache add ca-certificates
COPY --from=builder /africgreen-api /africgreen-api

EXPOSE 8080
CMD ["/africgreen-api"]
