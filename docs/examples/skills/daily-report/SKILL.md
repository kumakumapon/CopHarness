---
name: daily-report
description: 指定された期間の作業内容から日報を作成する。日報・作業報告を頼まれたときに使う。
---

# 日報の作り方

1. ユーザーに対象日と、参照してよい情報源（ワークスペースのメモ、git ログなど）を確認する。指定があればそれに従う。
2. `bash` で `git log --since=<日付> --oneline` を、`list_files` / `read_file` でメモを確認する。
3. `template.md` の形式で日報を書く（`skill` ツールで `file: "template.md"` を読む）。
4. 保存を頼まれたら `reports/<YYYY-MM-DD>.md` に `write_file` で保存する。
