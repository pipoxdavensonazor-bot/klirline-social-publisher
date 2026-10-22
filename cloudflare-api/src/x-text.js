import twitterText from "twitter-text";

export function xTextMetrics(text) {
  const parsed = twitterText.parseTweet(String(text ?? ""));
  return { weightedLength: parsed.weightedLength, valid: parsed.valid };
}
