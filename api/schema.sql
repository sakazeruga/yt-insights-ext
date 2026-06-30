-- ============================================================
-- YT Insights — さくらのMySQL セットアップSQL
-- さくらのコントロールパネル > データベース > phpMyAdmin で実行
-- ============================================================

CREATE TABLE IF NOT EXISTS bookmarks (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  video_id             VARCHAR(64)  NOT NULL UNIQUE,
  video_url            TEXT         NOT NULL,
  title                TEXT         NOT NULL,
  channel_name         VARCHAR(255),
  thumbnail_url        TEXT,
  duration             VARCHAR(32),

  tags                 JSON,
  user_notes           TEXT,

  summary              TEXT,
  key_points           JSON,
  important_timestamps JSON,
  category             VARCHAR(32),
  insights             TEXT,
  auto_tags            JSON,

  status               VARCHAR(16)  NOT NULL DEFAULT 'pending',

  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FULLTEXT INDEX idx_search (title, summary, insights)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
