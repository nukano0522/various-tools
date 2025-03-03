import requests
from datetime import datetime
import time
from urllib.parse import urlparse
import webbrowser


class WebArchiveHandler:
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }

    def check_url_status(self, url):
        try:
            response = requests.get(url, headers=self.headers, timeout=10)
            return response.status_code == 200
        except:
            return False

    def get_latest_archive(self, url):
        wayback_api = f"https://archive.org/wayback/available?url={url}"
        response = requests.get(wayback_api)
        data = response.json()
        return data["archived_snapshots"].get("closest")

    def save_to_wayback(self, url):
        save_url = f"https://web.archive.org/save/{url}"
        try:
            print("ページをアーカイブ中です...")
            response = requests.get(save_url, headers=self.headers)
            if response.status_code in [200, 301, 302]:
                print("アーカイブの保存に成功しました")
                # アーカイブが作成されるまで少し待機
                time.sleep(5)
                return True
            return False
        except Exception as e:
            print(f"アーカイブの保存中にエラーが発生しました: {e}")
            return False

    def handle_webpage(self, url):
        print(f"URLをチェック中: {url}")

        if self.check_url_status(url):
            print("ページは正常にアクセス可能です")
            return {"status": "live", "url": url}

        print("ページにアクセスできません。アーカイブを確認中...")
        archive_data = self.get_latest_archive(url)

        if archive_data:
            archive_url = archive_data["url"]
            timestamp = datetime.strptime(archive_data["timestamp"], "%Y%m%d%H%M%S")
            print(f"アーカイブが見つかりました（{timestamp.strftime('%Y年%m月%d日')}）")
            return {"status": "archived", "url": archive_url}

        print("既存のアーカイブが見つかりません。新しいアーカイブを作成します...")
        if self.save_to_wayback(url):
            print("新しいアーカイブの取得を試みています...")
            # 新しいアーカイブができるまで数回試行
            for _ in range(3):
                time.sleep(5)
                archive_data = self.get_latest_archive(url)
                if archive_data:
                    return {"status": "new_archive", "url": archive_data["url"]}

        return {"status": "failed", "url": None}


def main():
    handler = WebArchiveHandler()

    while True:
        url = input("\nURLを入力してください（終了する場合は 'q' を入力）: ")
        if url.lower() == "q":
            break

        if not urlparse(url).scheme:
            url = "https://" + url

        result = handler.handle_webpage(url)

        if result["status"] in ["archived", "new_archive"]:
            user_choice = input("\nアーカイブページを開きますか？(y/n): ")
            if user_choice.lower() == "y":
                webbrowser.open(result["url"])
        elif result["status"] == "failed":
            print("申し訳ありません。ページの取得とアーカイブの作成に失敗しました。")


if __name__ == "__main__":
    main()
