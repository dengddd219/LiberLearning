# Plan: Reddit Data Scraping Script

## Context
The user needs a lightweight Python script for scraping Reddit post data to support "social media product insights & pain point discovery". The approach uses Reddit's public `.json` endpoint (appending `.json` to post URLs) instead of the official API, for rapid validation purposes.

## Implementation

### Single file: `reddit_scraper.py`

**Core logic:**
1. Accept a list of Reddit post URLs
2. For each URL, append `.json` and fetch via `requests` with a custom `User-Agent`
3. Parse the JSON response to extract:
   - Text: `title`, `selftext`, top 3 comments by score (`body`)
   - Metrics: `score`, `upvote_ratio`, `num_comments`
   - Metadata: `subreddit`, `created_utc` (converted to readable date)
4. Print results to console in a readable format

**Key details:**
- Reddit `.json` returns a 2-element list: `[post_listing, comments_listing]`
- Top comments are in `response[1]['data']['children']`, sorted by score descending, take top 3
- `created_utc` is a Unix timestamp → convert with `datetime.fromtimestamp()`
- Must set a descriptive `User-Agent` header to avoid 429 errors
- Add a small delay between requests to be polite

**No external dependencies beyond `requests`.**

## Verification
- Run the script with 1-2 real Reddit post URLs
- Confirm all fields are correctly extracted and printed
