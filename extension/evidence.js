// Only excerpts selected from the extracted transcript become displayed evidence.
export function segmentId(index) { return `S${index}`; }

export function attachEvidence(preview, segments) {
  const indexed = new Map(segments.map((segment, index) => [segmentId(index), segment]));
  preview.key_takeaways = (preview.key_takeaways || []).map(item => {
    const segment = indexed.get(item.source_segment_id);
    if (!segment || !Number.isFinite(segment.startSeconds) || segment.startSeconds < 0 || !segment.text) {
      return {text: item.text, timestamp_seconds: null};
    }
    const seconds = Math.floor(segment.startSeconds);
    return {text: item.text, timestamp_seconds: seconds,
      source: {segmentId: item.source_segment_id, startSeconds: seconds, text: String(segment.text).slice(0, 800)}};
  });
  return preview;
}
