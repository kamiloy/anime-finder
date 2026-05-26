-- FanJi D1 数据库 Schema
-- Cloudflare D1 (SQLite at edge)

-- ===== 核心表 =====

-- 番剧主表
CREATE TABLE IF NOT EXISTS anime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_cn TEXT DEFAULT '',
  title_jp TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  cover_large_url TEXT DEFAULT '',
  bangumi_id INTEGER,
  anilist_id INTEGER,
  tmdb_id INTEGER,
  total_episodes INTEGER DEFAULT 0,
  air_date TEXT DEFAULT '',
  air_weekday INTEGER DEFAULT -1,
  is_airing INTEGER DEFAULT 0,
  platform TEXT DEFAULT '',
  nsfw INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  rank INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_cn TEXT DEFAULT '',
  count INTEGER DEFAULT 0
);

-- 番剧-标签关联
CREATE TABLE IF NOT EXISTS anime_tags (
  anime_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (anime_id, tag_id),
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 评分计数（1-10星分布）
CREATE TABLE IF NOT EXISTS rating_counts (
  anime_id INTEGER PRIMARY KEY,
  score_10 INTEGER DEFAULT 0,
  score_9 INTEGER DEFAULT 0,
  score_8 INTEGER DEFAULT 0,
  score_7 INTEGER DEFAULT 0,
  score_6 INTEGER DEFAULT 0,
  score_5 INTEGER DEFAULT 0,
  score_4 INTEGER DEFAULT 0,
  score_3 INTEGER DEFAULT 0,
  score_2 INTEGER DEFAULT 0,
  score_1 INTEGER DEFAULT 0,
  total_score INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
);

-- 新番时间表
CREATE TABLE IF NOT EXISTS calendar_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
);

-- ===== 扩展表（AniList 数据）=====

-- 角色表
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_cn TEXT DEFAULT '',
  name_jp TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  anilist_id INTEGER
);

-- 声优表
CREATE TABLE IF NOT EXISTS voice_actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_jp TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  anilist_id INTEGER
);

-- 番剧-角色-声优关联
CREATE TABLE IF NOT EXISTS anime_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  va_id INTEGER,
  is_main INTEGER DEFAULT 0,
  role TEXT DEFAULT '',
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (va_id) REFERENCES voice_actors(id) ON DELETE SET NULL
);

-- 关联作品
CREATE TABLE IF NOT EXISTS related_anime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL,
  related_id INTEGER NOT NULL,
  relation_type TEXT DEFAULT '',
  FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
  FOREIGN KEY (related_id) REFERENCES anime(id) ON DELETE CASCADE
);

-- ===== 运维表 =====

-- 同步日志
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT DEFAULT 'running',
  records_affected INTEGER DEFAULT 0,
  error TEXT
);

-- ===== 索引 =====

CREATE INDEX IF NOT EXISTS idx_anime_title_cn ON anime(title_cn);
CREATE INDEX IF NOT EXISTS idx_anime_bangumi_id ON anime(bangumi_id);
CREATE INDEX IF NOT EXISTS idx_anime_anilist_id ON anime(anilist_id);
CREATE INDEX IF NOT EXISTS idx_anime_air_weekday ON anime(air_weekday);
CREATE INDEX IF NOT EXISTS idx_anime_is_airing ON anime(is_airing);
CREATE INDEX IF NOT EXISTS idx_anime_score ON anime(score DESC);
CREATE INDEX IF NOT EXISTS idx_anime_rank ON anime(rank);
CREATE INDEX IF NOT EXISTS idx_anime_tags_anime_id ON anime_tags(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_tags_tag_id ON anime_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_rating_counts_anime_id ON rating_counts(anime_id);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_weekday ON calendar_entries(weekday);
CREATE INDEX IF NOT EXISTS idx_anime_characters_anime ON anime_characters(anime_id);
CREATE INDEX IF NOT EXISTS idx_related_anime_anime ON related_anime(anime_id);
