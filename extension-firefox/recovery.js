export function recoveryFor(error) {
  const message = String(error?.message || error || "Unknown error");
  if (/api key|api_key|incorrect.*key|authentication|401|cannot access.*model|model.*not found|TypeSafe/i.test(message)) {
    return {message: "Check your API connection, model access, and available credit in Settings.", action: "settings"};
  }
  if (/429|rate.limit|quota|credit|billing/i.test(message)) {
    return {message: "Your API account is limiting requests or has insufficient credit. Check your account, then restart the summary.", action: "settings"};
  }
  if (/caption language|requested captions|select these captions|selected caption|Best available/i.test(message)) {
    return {message: "The requested caption language could not be read. Choose Best available or another available language in Settings.", action: "settings"};
  }
  if (/could not extract the transcript|did not.*render.*transcript|transcript.*returned no.*rows|could not find.*Show transcript/i.test(message)) {
    return {message: "YouTube's captions could not be read. Reload the video, then restart the summary. You can also open Show transcript on YouTube before retrying.", action: "reload"};
  }
  if (/no readable transcript|no transcript|no captions|no caption|Show transcript button/i.test(message)) {
    return {message: "This video has no readable captions. Try another captioned video, or check its transcript on YouTube.", action: "none"};
  }
  if (/reload|changed video|navigated|no longer open|could not read|receiving end|connection.*establish/i.test(message)) {
    return {message: "The source video changed or its connection was lost. Reload the correct video, then restart the summary.", action: "reload"};
  }
  return {message: /timeout|timed out|stopped reporting|12-minute/i.test(message)
    ? "Processing stopped before completion. Restarting begins again and may incur new API charges."
    : "The summary could not finish. Check your connection and restart; a restart may incur new API charges.", action: "retry"};
}
