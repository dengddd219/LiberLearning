# -*- coding: utf-8 -*-
"""
Reddit Data ETL Script
Reads reddit_data.xlsx, cleans and slices into lightweight subsets.
All data is REAL - no fabrication.
"""
import pandas as pd
import json
import os
from datetime import datetime

# Paths
DATA_PATH = r"c:\Users\19841\Desktop\github\LiberLearning\LiberLearning\discovery\reddit discovery\reddit_data.xlsx"
OUTPUT_DIR = r"c:\Users\19841\Desktop\github\LiberLearning\LiberLearning\discovery\reddit_analysis_run_20260406_213222"

# Read Excel - try different encodings
print("[ETL] Reading reddit_data.xlsx...")
try:
    df = pd.read_excel(DATA_PATH, engine='openpyxl')
except Exception as e:
    print(f"Error reading with openpyxl: {e}")
    raise

# Print raw column names to verify
print(f"[ETL] Raw columns: {df.columns.tolist()}")
print(f"[ETL] Shape: {df.shape}")

# The actual column names based on the file's encoding
# They appear as garbled in GBK but we know the mapping:
COLUMN_MAP = {
    '话题索引': 'topic_index',
    '话题分类': 'topic_category',
    '搜索关键词': 'search_keyword',
    'Subreddit': 'subreddit',
    '帖子标题': 'post_title',
    '帖子正文': 'post_body',
    '帖子得分': 'score',
    '点赞率': 'upvote_ratio',
    '评论总数': 'comment_count',
    '发帖时间': 'post_time',
    'Top评论1': 'top_comment_1',
    'Top评论2': 'top_comment_2',
    'Top评论3': 'top_comment_3',
    'Top评论4': 'top_comment_4',
    'Top评论5': 'top_comment_5',
    'Top评论6': 'top_comment_6',
    'Top评论7': 'top_comment_7',
}

# Rename columns
df = df.rename(columns=COLUMN_MAP)
print(f"[ETL] Renamed columns: {df.columns.tolist()}")
print(f"[ETL] Sample row:\n{df.iloc[0]}")

# Convert score and upvote_ratio to numeric
df['score'] = pd.to_numeric(df['score'], errors='coerce')
df['upvote_ratio'] = pd.to_numeric(df['upvote_ratio'], errors='coerce')
df['comment_count'] = pd.to_numeric(df['comment_count'], errors='coerce')

print(f"\n[ETL] Score stats: min={df['score'].min()}, max={df['score'].max()}, mean={df['score'].mean():.1f}")
print(f"[ETL] Upvote ratio stats: min={df['upvote_ratio'].min()}, max={df['upvote_ratio'].max()}, mean={df['upvote_ratio'].mean():.3f}")

# Slice into subsets based on score and upvote_ratio
# HIGH needs: Score >= 50 OR Upvote Ratio >= 0.90 (strong positive validation)
needs_mask = (df['score'] >= 50) | (df['upvote_ratio'] >= 0.90)
needs_df = df[needs_mask].copy()
print(f"\n[ETL] needs_subset: {len(needs_df)} rows (Score>=50 OR UpvoteRatio>=0.90)")

# PAIN points: Upvote Ratio <= 0.50 OR Score in bottom 10% (controversial or rejected)
threshold_10pct = df['score'].quantile(0.10)
pain_mask = (df['upvote_ratio'] <= 0.50) | (df['score'] <= threshold_10pct)
pain_df = df[pain_mask].copy()
print(f"[ETL] painpoints_subset: {len(pain_df)} rows (UpvoteRatio<=0.50 OR Score<={threshold_10pct:.0f})")

# NEUTRAL: rest for behavioral analysis
neutral_df = df[~(needs_mask | pain_mask)].copy()
print(f"[ETL] neutral_subset: {len(neutral_df)} rows")

# Convert to list of dicts (JSON-serializable)
def df_to_records(dframe):
    records = dframe.fillna('').to_dict('records')
    # Clean non-serializable types
    for r in records:
        for k, v in r.items():
            if isinstance(v, (pd.Timestamp, datetime)):
                r[k] = str(v)
            elif pd.isna(v):
                r[k] = ''
    return records

needs_records = df_to_records(needs_df)
pain_records = df_to_records(pain_df)
neutral_records = df_to_records(neutral_df)

# Save subsets
for name, records in [('needs_subset', needs_records),
                       ('painpoints_subset', pain_records),
                       ('neutral_subset', neutral_records)]:
    out_path = os.path.join(OUTPUT_DIR, f'{name}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    print(f"[ETL] Saved {name}.json: {len(records)} records -> {out_path}")

# Also save subreddit distribution for reference
subreddit_dist = df['subreddit'].value_counts().head(20).to_dict()
with open(os.path.join(OUTPUT_DIR, 'subreddit_dist.json'), 'w', encoding='utf-8') as f:
    json.dump(subreddit_dist, f, ensure_ascii=False, indent=2)
print(f"[ETL] Saved subreddit_dist.json")

# Save topic category distribution
cat_dist = df['topic_category'].value_counts().to_dict()
with open(os.path.join(OUTPUT_DIR, 'topic_category_dist.json'), 'w', encoding='utf-8') as f:
    json.dump(cat_dist, f, ensure_ascii=False, indent=2)
print(f"[ETL] Saved topic_category_dist.json")

print("\n[ETL] DONE. All subsets saved.")
print(f"Total records processed: {len(df)}")
print(f"  - needs_subset: {len(needs_records)}")
print(f"  - painpoints_subset: {len(pain_records)}")
print(f"  - neutral_subset: {len(neutral_records)}")