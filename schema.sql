-- ============================================================
-- YT Insights — Supabase セットアップSQL
-- Supabase > SQL Editor に貼り付けて実行してください
-- ============================================================

CREATE TABLE IF NOT EXISTS bookmarks (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id             text        UNIQUE NOT NULL,
  video_url            text        NOT NULL,
  title                text        NOT NULL,
  channel_name         text,
  thumbnail_url        text,
  duration             text,

  -- ユーザー入力
  tags                 text[]      DEFAULT '{}',
  user_notes           text        DEFAULT '',

  -- Gemini分析結果
  summary              text,
  key_points           jsonb       DEFAULT '[]',
  important_timestamps jsonb       DEFAULT '[]',
  category             text,
  insights             text,
  auto_tags            text[]      DEFAULT '{}',

  -- ステータス管理
  status               text        DEFAULT 'pending',  -- pending | analyzing | done | error

  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_bm_title    ON bookmarks USING gin(to_tsvector('simple', coalesce(title, '')));
CREATE INDEX IF NOT EXISTS idx_bm_tags     ON bookmarks USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_bm_auto_tags ON bookmarks USING gin(auto_tags);
CREATE INDEX IF NOT EXISTS idx_bm_category ON bookmarks (category);
CREATE INDEX IF NOT EXISTS idx_bm_created  ON bookmarks (created_at DESC);

-- ============================================================
-- オプション: Row Level Security を個人利用向けに無効化
-- （複数ユーザー対応が必要な場合はRLSポリシーを設定してください）
-- ============================================================
-- ALTER TABLE bookmarks DISABLE ROW LEVEL SECURITY;
