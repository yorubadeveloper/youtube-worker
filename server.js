import express from 'express';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import { fetchTranscript as getYoutubeTranscript } from 'youtube-transcript-plus';
import { ProxyAgent } from 'undici';
import { fetch as undiciFetch } from 'undici';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Proxy configuration (optional)
const PROXY_URL = process.env.PROXY_URL || null;
const USE_PROXY = process.env.USE_PROXY === 'true' && PROXY_URL;
let proxyAgent = null;

if (USE_PROXY) {
  proxyAgent = new ProxyAgent(PROXY_URL);
  console.log(`Proxy enabled: ${PROXY_URL.replace(/\/\/.*@/, '//***@')}`); // Hide credentials in logs
} else {
  console.log('Proxy disabled - using direct connection');
}

// Initialize cache with 1 hour TTL and check period of 10 minutes
const cache = new NodeCache({
  stdTTL: 3600, // 1 hour default TTL
  checkperiod: 600 // Check for expired keys every 10 minutes
});

// Rate limiting: 30 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// CORS configuration
app.use(cors());

// Apply rate limiting to all routes
app.use(limiter);

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    proxyEnabled: USE_PROXY,
    cacheStats: cache.getStats()
  });
});

// Main transcript endpoint
app.get('/transcript', async (req, res) => {
  const timeout = parseInt(process.env.TIMEOUT || '30000'); // 30 second default timeout

  try {
    // Request validation
    const videoUrl = req.query.videoUrl;

    if (!videoUrl) {
      return res.status(400).json({
        error: 'Missing videoUrl parameter',
        usage: 'GET /transcript?videoUrl=<youtube_url>'
      });
    }

    if (typeof videoUrl !== 'string' || videoUrl.length > 200) {
      return res.status(400).json({
        error: 'Invalid videoUrl parameter'
      });
    }

    // Extract video ID for caching
    let videoId;
    try {
      videoId = extractVideoId(videoUrl);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    // Check cache first
    const cachedResult = cache.get(videoId);
    if (cachedResult) {
      console.log(`Cache hit for video: ${videoId}`);
      return res.json({
        ...cachedResult,
        cached: true
      });
    }

    console.log(`Cache miss for video: ${videoId}, fetching from YouTube...`);

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeout);
    });

    // Fetch transcript with timeout
    const transcriptPromise = fetchTranscript(videoUrl);
    const result = await Promise.race([transcriptPromise, timeoutPromise]);

    // Cache the result
    cache.set(videoId, result);

    res.json({
      ...result,
      cached: false
    });

  } catch (error) {
    console.error('Error fetching transcript:', error);

    if (error.message === 'Request timeout') {
      return res.status(504).json({
        error: 'Request timeout - the video transcript took too long to fetch'
      });
    }

    res.status(500).json({
      error: `Error fetching transcript: ${error.message}`
    });
  }
});

// Cache management endpoints
app.get('/cache/stats', (req, res) => {
  res.json({
    stats: cache.getStats(),
    keys: cache.keys().length
  });
});

app.delete('/cache/:videoId', (req, res) => {
  const { videoId } = req.params;
  const deleted = cache.del(videoId);
  res.json({
    success: deleted > 0,
    message: deleted > 0 ? 'Cache cleared' : 'Video not found in cache'
  });
});

app.delete('/cache', (req, res) => {
  cache.flushAll();
  res.json({
    success: true,
    message: 'All cache cleared'
  });
});

// Helper functions
async function fetchTranscript(videoUrl) {
  try {
    const videoId = extractVideoId(videoUrl);

    // Configure options for youtube-transcript-plus
    const options = {};

    // If proxy is enabled, add custom fetch functions that use the proxy
    if (USE_PROXY && proxyAgent) {
      const customFetch = (input, init = {}) => {
        // Handle both URL strings and Request objects
        let url = input;
        let options = init;

        // If input is a Request object, extract URL and options
        if (typeof input === 'object' && input.url) {
          url = input.url;
          options = {
            method: input.method,
            headers: input.headers,
            body: input.body,
            ...init
          };
        }

        return undiciFetch(url, {
          ...options,
          dispatcher: proxyAgent
        });
      };

      options.videoFetch = customFetch;
      options.playerFetch = customFetch;
      options.transcriptFetch = customFetch;
    }

    // Fetch transcript using youtube-transcript-plus
    // Don't specify language - it will automatically use the first available
    const transcriptData = await getYoutubeTranscript(videoId, options);

    if (!transcriptData || transcriptData.length === 0) {
      throw new Error('No transcript available for this video');
    }

    // Format the transcript segments to match our API response format
    const formattedTranscript = transcriptData.map(segment => ({
      start: formatTime(segment.offset), // offset is in milliseconds
      text: segment.text,
      duration: segment.duration / 1000 // Convert to seconds
    }));

    // Get video title (we'll need to make a separate call or extract from URL)
    // For now, we'll just use the video ID as a fallback
    const title = `Video ${videoId}`; // You can enhance this later with a separate API call

    return {
      title: title,
      videoId: videoId,
      transcript: formattedTranscript,
      segmentCount: formattedTranscript.length,
      language: transcriptData[0]?.lang || 'unknown'
    };
  } catch (error) {
    console.error('Error fetching transcript:', error);

    // Handle specific youtube-transcript-plus errors
    if (error.message?.includes('Video unavailable')) {
      throw new Error('Video is unavailable or private');
    } else if (error.message?.includes('Transcript is disabled')) {
      throw new Error('Transcripts are disabled for this video');
    } else if (error.message?.includes('No transcripts available')) {
      throw new Error('No transcript available for this video');
    }

    throw error;
  }
}

const formatTime = (milliseconds) => {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map(v => v.toString().padStart(2, '0'))
    .join(':');
};

const extractVideoId = (url) => {
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]+)/,
    /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  throw new Error('Invalid YouTube URL');
};

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    availableEndpoints: [
      'GET /health',
      'GET /transcript?videoUrl=<youtube_url>',
      'GET /cache/stats',
      'DELETE /cache/:videoId',
      'DELETE /cache'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`YouTube Transcript API Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Transcript endpoint: http://localhost:${PORT}/transcript?videoUrl=<youtube_url>`);
});
