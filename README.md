# YouTube Transcript API Server

A production-ready Node.js API server for fetching YouTube video transcripts with built-in rate limiting, caching, and timeout protection.

## Features

- **Rate Limiting**: 30 requests per minute per IP (configurable)
- **In-Memory Caching**: 1-hour cache TTL to reduce YouTube API calls
- **Request Validation**: Validates all incoming requests
- **Timeout Protection**: 30-second timeout on transcript fetching (configurable)
- **YouTube Transcript Fetching**: Reliable transcript extraction using youtube-transcript-plus (bypasses YouTube bot-detection)
- **Multi-Language Support**: Automatically fetches transcripts in available languages
- **No CPU Limits**: Runs on your own infrastructure
- **Lower Ban Risk**: Caching and rate limiting reduce API load
- **Health Checks**: Built-in health check endpoint for monitoring
- **CORS Support**: Cross-origin requests enabled
- **Docker Ready**: Containerized for easy deployment

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. The server will start on `http://localhost:3000`

### Using Docker

1. Build and run with Docker Compose:
```bash
docker-compose up -d
```

2. Check the logs:
```bash
docker-compose logs -f
```

3. Stop the server:
```bash
docker-compose down
```

## Deployment on Dokploy (EC2)

### Option 1: GitHub Repository

1. Push this code to your GitHub repository
2. In Dokploy dashboard, create a new application
3. Select "GitHub" as the source
4. Choose your repository
5. Set the following build settings:
   - **Build Type**: Dockerfile
   - **Port**: 3000
   - **Health Check Path**: /health
6. Add environment variables (optional):
   - `PORT`: 3000
   - `TIMEOUT`: 30000
7. Deploy!

### Option 2: Docker Compose

1. In Dokploy, create a new "Compose" application
2. Upload or paste your `docker-compose.yml`
3. Set environment variables if needed
4. Deploy!

### Option 3: Manual Docker Build

1. Build the image:
```bash
docker build -t youtube-transcript-api .
```

2. Run the container:
```bash
docker run -d -p 3000:3000 --name youtube-transcript-api youtube-transcript-api
```

## API Endpoints

### GET /health
Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-11T10:30:00.000Z",
  "cacheStats": {
    "keys": 5,
    "hits": 42,
    "misses": 8,
    "ksize": 5,
    "vsize": 150000
  }
}
```

### GET /transcript?videoUrl=<youtube_url>
Fetch transcript for a YouTube video.

**Parameters:**
- `videoUrl` (required): YouTube video URL or video ID

**Example Request:**
```bash
curl "http://localhost:3000/transcript?videoUrl=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

**Response:**
```json
{
  "title": "Video Title",
  "videoId": "dQw4w9WgXcQ",
  "transcript": [
    {
      "start": "00:00:00",
      "text": "Hello world",
      "duration": 2.5
    }
  ],
  "segmentCount": 150,
  "cached": false
}
```

**Supported URL Formats:**
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- Direct video ID: `VIDEO_ID`

### GET /cache/stats
Get cache statistics.

**Response:**
```json
{
  "stats": {
    "keys": 5,
    "hits": 42,
    "misses": 8
  },
  "keys": 5
}
```

### DELETE /cache/:videoId
Clear cache for a specific video.

**Example:**
```bash
curl -X DELETE "http://localhost:3000/cache/dQw4w9WgXcQ"
```

### DELETE /cache
Clear all cached data.

**Example:**
```bash
curl -X DELETE "http://localhost:3000/cache"
```

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Timeout in milliseconds (default: 30000 = 30 seconds)
TIMEOUT=30000

# Rate Limiting (requests per minute per IP)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30

# Proxy Configuration (Optional)
USE_PROXY=false
# PROXY_URL=http://your-proxy-server:port
```

### Proxy Configuration (Optional)

The server includes built-in proxy support for cases where YouTube blocks your IP address.

**When to enable proxies:**
- Your EC2 IP gets blocked by YouTube (returns 403 or other errors)
- High volume usage (thousands of unique video requests per day)
- Multiple users requesting different videos simultaneously

**How to enable:**

1. Get a proxy service (options below)
2. Set environment variables:
   ```env
   USE_PROXY=true
   PROXY_URL=http://your-proxy:port
   ```
3. Restart the server

**Proxy Services:**

**Free Options:**
- [Free Proxy List](https://free-proxy-list.net/) - Public proxies (unreliable, use for testing)
- [ProxyScrape](https://proxyscrape.com/free-proxy-list) - Free public proxies

**Paid Options (Recommended for production):**
- [BrightData](https://brightdata.com/) - $500/month, 40GB
- [Smartproxy](https://smartproxy.com/) - $50/month, 5GB
- [ProxyMesh](https://proxymesh.com/) - $10/month, 20 IPs
- [Webshare](https://www.webshare.io/) - $2.99/month, 10 proxies

**Example Configuration:**

```env
# Using authenticated proxy
USE_PROXY=true
PROXY_URL=http://username:password@proxy.example.com:8080

# Using public proxy
USE_PROXY=true
PROXY_URL=http://proxy-server.com:3128
```

**Check Proxy Status:**
```bash
curl http://localhost:3000/health
```

Response will show `"proxyEnabled": true` if proxy is active.

### Customizing Rate Limits

Edit `server.js` to adjust rate limiting:

```javascript
const limiter = rateLimit({
  windowMs: 60 * 1000, // Time window
  max: 30, // Max requests per window
  message: 'Too many requests from this IP, please try again later.'
});
```

### Customizing Cache Settings

Edit `server.js` to adjust cache TTL:

```javascript
const cache = new NodeCache({
  stdTTL: 3600, // Time to live in seconds (1 hour)
  checkperiod: 600 // Check for expired keys every 10 minutes
});
```

## Monitoring

### Health Checks

The `/health` endpoint returns cache statistics and server status. Use this for monitoring tools like:
- Uptime Kuma
- Prometheus
- Datadog
- New Relic

### Logs

View logs with Docker:
```bash
docker logs -f youtube-transcript-api
```

With Docker Compose:
```bash
docker-compose logs -f
```

## Error Handling

The API returns appropriate HTTP status codes:

- `200`: Success
- `400`: Bad request (missing or invalid parameters)
- `404`: Endpoint not found
- `429`: Too many requests (rate limit exceeded)
- `500`: Internal server error
- `504`: Gateway timeout (request took too long)

## Performance Tips

1. **Caching**: The server caches transcripts for 1 hour. Adjust `stdTTL` in `server.js` if needed.
2. **Rate Limiting**: Adjust rate limits based on your expected traffic.
3. **Timeout**: Increase timeout for longer videos or slower connections.
4. **Memory**: Monitor memory usage if caching many large transcripts.

## Troubleshooting

### "No transcript available for this video"
- The video may not have captions/transcripts enabled
- The video may be private or region-locked
- Try a different video to verify the API is working

### Rate limit errors
- Wait for the rate limit window to reset (default: 1 minute)
- Increase `RATE_LIMIT_MAX` if you control the client

### Timeout errors
- Increase the `TIMEOUT` environment variable
- Check your network connection to YouTube
- Some videos may take longer to process

## Migration from Cloudflare Workers

If you're migrating from the Cloudflare Worker version:

1. The API endpoint remains the same: `/transcript?videoUrl=<url>`
2. Response format is identical (with added `cached` field)
3. No more CPU time limits
4. Better caching and rate limiting
5. Health check endpoint at `/health`

## License

Private

## Support

For issues or questions, please check the GitHub repository issues.
