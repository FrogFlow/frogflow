export type InstagramMediaInfo = {
  shortcode: string | null;
  cleanUrl: string | null;
  type: "reel" | "post" | "story" | "unknown";
};

/**
 * Parses Instagram URLs, shortcodes, and identifiers.
 * Extracts clean canonical URLs and unique shortcodes for Reels, Posts, and Stories.
 */
export function extractInstagramMediaInfo(urlOrString: string | null | undefined): InstagramMediaInfo {
  if (!urlOrString) return { shortcode: null, cleanUrl: null, type: "unknown" };
  const trimmed = urlOrString.trim();

  // Match reel: instagram.com/reel/SHORTCODE or /reels/SHORTCODE
  const reelMatch = trimmed.match(/(?:instagram\.com|instagr\.am)\/(?:reel|reels)\/([A-Za-z0-9_-]+)/i);
  if (reelMatch) {
    return {
      shortcode: reelMatch[1],
      cleanUrl: `https://www.instagram.com/reel/${reelMatch[1]}/`,
      type: "reel",
    };
  }

  // Match post: instagram.com/p/SHORTCODE
  const postMatch = trimmed.match(/(?:instagram\.com|instagr\.am)\/p\/([A-Za-z0-9_-]+)/i);
  if (postMatch) {
    return {
      shortcode: postMatch[1],
      cleanUrl: `https://www.instagram.com/p/${postMatch[1]}/`,
      type: "post",
    };
  }

  // Match story: instagram.com/stories/username/1234567890
  const storyMatch = trimmed.match(/(?:instagram\.com|instagr\.am)\/stories\/[^/]+\/(\d+)/i);
  if (storyMatch) {
    return {
      shortcode: storyMatch[1],
      cleanUrl: `https://www.instagram.com/stories/${storyMatch[1]}/`,
      type: "story",
    };
  }

  // If it's a bare shortcode (letters, numbers, _, - of length 5-30) without slashes or dots or spaces
  if (/^[A-Za-z0-9_-]{5,30}$/.test(trimmed) && !trimmed.includes("/") && !trimmed.includes(".")) {
    return {
      shortcode: trimmed,
      cleanUrl: `https://www.instagram.com/reel/${trimmed}/`,
      type: "reel",
    };
  }

  return { shortcode: null, cleanUrl: trimmed, type: "unknown" };
}
