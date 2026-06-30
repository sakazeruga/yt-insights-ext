# ◈ YT Insights — AI YouTube Bookmark Extension

YouTube動画をGeminiで自動解析し、Supabaseにクラウド保存するChrome拡張機能。

---

## 機能

| 機能 | 詳細 |
|------|------|
| サイドパネル常駐 | YouTube動画ページを開くと自動表示 |
| タグ付け | 任意タグを手動で付与（Enter区切り）|
| Gemini自動分析 | 要約・キーポイント・重要タイムスタンプ・知見・自動タグを同時抽出 |
| クリック可能タイムスタンプ | 該当シーンに直接ジャンプ |
| Supabaseクラウド保存 | 全端末から参照・検索可能 |
| ライブラリ検索 | タイトル・要約・知見の全文検索＋カテゴリフィルター |
| ローカルフォールバック | Supabase未設定でもブラウザ内保存で動作 |

---

## セットアップ

### 1. Gemini APIキーの取得
1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. "Create API Key" → APIキーをコピー

### 2. Supabaseプロジェクトの作成（任意・クラウド保存する場合）
1. [supabase.com](https://supabase.com) で無料アカウント作成
2. 新規プロジェクト作成
3. **SQL Editor** を開き `schema.sql` の内容を貼り付けて実行
4. **Settings → API** から以下をコピー：
   - `Project URL`（例: `https://xxxxxxxxxxxx.supabase.co`）
   - `anon public` キー（`eyJ…` から始まる長い文字列）

### 3. Chrome拡張機能のインストール
1. `chrome://extensions` を開く
2. 右上の **「デベロッパーモード」** をON
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. このフォルダ（`yt-insights-ext`）を選択

### 4. APIキーの設定
1. Chrome右上の拡張機能アイコン → **「YT Insights」** の歯車アイコン（オプション）
2. Gemini API Key と Supabase情報を入力 → 保存

---

## 使い方

1. YouTube動画ページを開く → サイドパネルが自動表示
2. タグを入力（Enter で確定）、メモを記入
3. **「ブックマーク＋AI分析」** ボタンをクリック
4. Geminiが動画を解析（30〜90秒）→ 結果が自動表示
5. **「ライブラリ」** タブで過去のブックマークを検索・閲覧

---

## アーキテクチャ

```
content.js           → YouTube DOM から動画情報を抽出
     ↓ chrome.runtime.sendMessage
background.js        → chrome.storage.local に currentVideo を保存
                      → Gemini API (YouTube URL直接渡し) を呼び出し
                      → 結果を chrome.storage.local に書き込み
                      → Supabase REST API でCRUD
     ↓ chrome.storage.onChanged
sidepanel.js         → ストレージ変更を検知してリアルタイムUI更新
```

**Gemini YouTube URL直接解析**: YouTube URLをそのままGeminiに渡すことで、
トランスクリプト取得やYouTube Data APIは不要。動画内容・字幕・映像を
Geminiが直接処理します。

---

## 技術スタック
- **Chrome Extension Manifest V3** + Side Panel API
- **Gemini 2.0 Flash** — YouTube URL直接解析
- **Supabase** — PostgreSQL + REST API（認証不要のanonキー使用）
- **Vanilla JS** — 依存ライブラリなし

---

## 注意事項
- Gemini 2.0 Flash はYouTube URLを直接処理できますが、非常に短い動画（数十秒）や
  字幕なし動画は精度が下がる場合があります
- Supabase RLSはデフォルト無効です。複数ユーザーでの利用や公開プロジェクトでは
  必ずRLSポリシーを設定してください
- Gemini APIは無料枠あり（2024年時点: 毎分60リクエスト、日1500リクエスト）
