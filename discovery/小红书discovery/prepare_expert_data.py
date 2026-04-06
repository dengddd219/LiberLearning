import json, os

data_path = 'c:/Users/19841/Desktop/github/LiberLearning/LiberLearning/discovery/discovery/all_data.json'
with open(data_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

out_dir = 'c:/Users/19841/Desktop/github/LiberLearning/LiberLearning/discovery/discovery/expert_data'
os.makedirs(out_dir, exist_ok=True)

def safe_get_comments(comments_list):
    """Filter out malformed comment records."""
    result = []
    for c in comments_list:
        if isinstance(c, dict) and 'content' in c:
            result.append({'content': c['content'], 'ip_location': c.get('ip_location', '')})
    return result

# Expert 1: JTBD - compact version with all posts/comments
jtbd_data = []
for item in data:
    entry = {'category': item['category'], 'keyword': item['keyword']}
    entry['posts'] = [
        {'title': p.get('title',''), 'desc': p.get('desc',''), 'liked_count': p.get('liked_count','0'), 'comment_count': p.get('comment_count','0')}
        for p in item.get('posts', [])
    ]
    entry['comments'] = safe_get_comments(item.get('comments', []))
    jtbd_data.append(entry)

with open(out_dir + '/expert1_jtbd.json', 'w', encoding='utf-8') as f:
    json.dump(jtbd_data, f, ensure_ascii=False, indent=2)
posts1 = sum(len(e['posts']) for e in jtbd_data)
comments1 = sum(len(e['comments']) for e in jtbd_data)
print(f'Expert1 JTBD: {len(jtbd_data)} categories, {posts1} posts, {comments1} comments')

# Expert 2: Kano - full data
with open(out_dir + '/expert2_kano.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
posts2 = sum(len(item['posts']) for item in data)
print(f'Expert2 Kano: {len(data)} categories, {posts2} posts')

# Expert 3: Competitor - full data
with open(out_dir + '/expert3_competitor.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(f'Expert3 Competitor: {len(data)} categories')

# Expert 4: Learning science - full data
with open(out_dir + '/expert4_learning.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(f'Expert4 Learning: {len(data)} categories')

# Expert 5: Behavior/Psychology - full data
with open(out_dir + '/expert5_behavior.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(f'Expert5 Behavior: {len(data)} categories')

print('All expert data files prepared successfully!')