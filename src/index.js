/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx) {
		const { searchParams } = new URL(request.url);
		const videoUrl = searchParams.get('videoUrl');

		if (!videoUrl) {
			return new Response('Missing videoUrl parameter', { status: 400 });
		}

		try {
			const transcript = await fetchTranscript(videoUrl);
			return new Response(transcript, {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			return new Response(`Error fetching transcript: ${error.message}`, { status: 500 });
		}
	}
};

import { Innertube } from 'youtubei.js/cf-worker';

async function fetchTranscript(videoUrl) {
	try {
		let videoId = extractVideoId(videoUrl);
		const yt = await Innertube.create();
		const info = await yt.getInfo(videoId);
		const transcriptInfo = await info.getTranscript();

		const video = await yt.getBasicInfo(videoId);
		const transcript = await video?.captions?.caption_tracks?.[0]?.base_url;


		if (!transcriptInfo?.transcript?.content?.body?.initial_segments) {
			throw new Error('No transcript available for this video');
		}
		const segments = transcriptInfo.transcript.content.body.initial_segments
			.filter(segment => segment.type === 'TranscriptSegment');

		if (!segments || segments.length === 0) {
			throw new Error('No transcript segments available');
		}
		const formattedTranscript = segments.map(segment => ({
			start: formatTime(segment.start_ms),
			text: segment.snippet.text,
			duration: (segment.end_ms - segment.start_ms) / 1000
		}))
		return JSON.stringify({
			title: info.basic_info.title,
			transcript: formattedTranscript
		});
	} catch (error) {
		console.error('Error fetching transcript:', error);
		throw error;
	}
}

const formatTime = (seconds) => {
	const date = new Date(null);
	date.setSeconds(seconds);
	return date.toISOString().substr(11, 8);
};

const extractVideoId = (url) => {
	const patterns = [
		/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
		/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/,
		/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]+)/
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}

	throw new Error('Invalid YouTube URL');
};
