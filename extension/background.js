// 拡張機能のインストール時に初期設定を行う
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ 
    autoArchive: true,
    showNotification: true,
    archiveHistory: [],
    enabledArchives: {
      waybackMachine: true,
      archiveToday: false,
      googleCache: true,
      memento: false
    }
  });
  
  // 初期化時にフラグをリセット
  isSearching = false;
});

// グローバル変数
let isSearching = false;

// 拡張機能が起動するたびにフラグをリセット
isSearching = false;

// メッセージリスナーを追加
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('メッセージを受信:', request.action);
  
  if (request.action === 'searchArchives') {
    // 既に検索中の場合は拒否
    if (isSearching) {
      console.log('別の検索が進行中です');
      sendResponse({ success: false, error: '別の検索が進行中です' });
      return false;
    }
    
    console.log('アーカイブ検索開始:', request.url);
    isSearching = true;
    
    // 即座に応答を返して接続を維持
    sendResponse({ success: true, processing: true });
    
    // 有効なアーカイブサービスを確認
    const enabledArchives = request.enabledArchives || { waybackMachine: true };
    const url = request.url;
    
    // 検索結果を格納する配列
    const archives = [];
    let searchPromises = [];
    
    // Wayback Machineの検索
    if (enabledArchives.waybackMachine) {
      searchPromises.push(
        searchWaybackMachine(url)
          .then(result => {
            if (result.found) {
              archives.push(result);
            }
          })
          .catch(error => {
            console.error('Wayback Machine検索エラー:', error);
          })
      );
    }
    
    // Google Cacheの検索
    if (enabledArchives.googleCache) {
      searchPromises.push(
        searchGoogleCache(url)
          .then(result => {
            if (result.found) {
              archives.push(result);
            }
          })
          .catch(error => {
            console.error('Google Cache検索エラー:', error);
          })
      );
    }
    
    // すべての検索が完了したら結果を処理
    Promise.all(searchPromises)
      .then(() => {
        isSearching = false;
        
        // 結果を整理
        const result = {
          found: archives.length > 0,
          archives: archives,
          bestArchive: archives.length > 0 ? findBestArchive(archives) : null
        };
        
        // 結果をストレージに保存
        chrome.storage.local.set({ 
          lastSearchResult: {
            url: url,
            result: result,
            timestamp: Date.now()
          }
        });
      })
      .catch(error => {
        console.error('検索処理エラー:', error);
        isSearching = false;
        
        // エラー情報をストレージに保存
        chrome.storage.local.set({ 
          lastSearchResult: {
            url: url,
            error: error.message || '不明なエラー',
            timestamp: Date.now()
          }
        });
      });
    
    // 非同期処理を開始したことを示すためにtrueを返す
    return true;
  } 
  else if (request.action === 'getLastSearchResult') {
    // 最後の検索結果を取得
    chrome.storage.local.get('lastSearchResult', (data) => {
      if (data.lastSearchResult) {
        sendResponse({ 
          success: true, 
          data: data.lastSearchResult 
        });
      } else {
        sendResponse({ 
          success: false, 
          error: '検索結果がありません' 
        });
      }
    });
    return true;
  }
  else if (request.action === 'resetSearchFlag') {
    // 検索フラグをリセットするための特別なアクション
    console.log('検索フラグをリセットします');
    isSearching = false;
    sendResponse({ success: true });
    return false;
  }
  else if (request.action === 'addToHistory') {
    console.log('履歴に追加:', request.originalUrl);
    
    // 履歴に追加
    chrome.storage.sync.get({ archiveHistory: [] }, (data) => {
      const history = data.archiveHistory;
      
      // 同じURLのエントリがあれば削除
      const filteredHistory = history.filter(item => item.originalUrl !== request.originalUrl);
      
      // 新しいエントリを追加
      filteredHistory.push({
        originalUrl: request.originalUrl,
        archiveUrl: request.archiveUrl,
        timestamp: request.timestamp,
        service: request.service,
        date: new Date().toISOString()
      });
      
      // 履歴が多すぎる場合は古いものを削除（最大50件）
      const trimmedHistory = filteredHistory.slice(-50);
      
      chrome.storage.sync.set({ archiveHistory: trimmedHistory }, () => {
        sendResponse({ success: true });
      });
    });
    
    // 非同期レスポンスを使用するために true を返す
    return true;
  }
  
  // 未知のアクションの場合
  sendResponse({ success: false, error: '未知のアクション' });
  return false;
});

// Wayback Machine (Internet Archive) を検索
async function searchWaybackMachine(url) {
  console.log('Wayback Machine検索開始:', url);
  
  try {
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Wayback Machine応答:', data);
    
    if (data.archived_snapshots && data.archived_snapshots.closest) {
      return {
        found: true,
        service: 'Wayback Machine',
        url: data.archived_snapshots.closest.url,
        timestamp: data.archived_snapshots.closest.timestamp
      };
    } else {
      return { found: false, service: 'Wayback Machine' };
    }
  } catch (error) {
    console.error('Wayback Machine検索エラー:', error);
    return { found: false, service: 'Wayback Machine', error: error.message };
  }
}

// Google Cache を検索
async function searchGoogleCache(url) {
  console.log('Google Cache検索開始:', url);
  
  return new Promise((resolve) => {
    try {
      // Google Cacheの形式でURLを構築
      const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
      
      // XMLHttpRequestを使用してリクエスト
      const xhr = new XMLHttpRequest();
      xhr.open('GET', cacheUrl, true);
      
      // タイムアウトを設定
      xhr.timeout = 5000;
      
      xhr.onload = function() {
        if (xhr.status === 200) {
          // レスポンスのテキストを取得
          const text = xhr.responseText;
          
          // 「一致する情報は見つかりませんでした」というメッセージがあるか確認
          if (text.includes('一致する情報は見つかりませんでした') || 
              text.includes('No information is available for this page')) {
            resolve({ 
              found: false, 
              service: 'Google Cache', 
              error: 'キャッシュが見つかりませんでした' 
            });
            return;
          }
          
          // 現在の日時をタイムスタンプとして使用
          const now = new Date();
          const timestamp = now.toISOString().replace(/[-T:]/g, '').split('.')[0];
          
          // キャッシュが存在する場合
          resolve({
            found: true,
            service: 'Google Cache',
            url: cacheUrl,
            timestamp: timestamp
          });
        } else {
          resolve({ 
            found: false, 
            service: 'Google Cache', 
            error: `キャッシュが見つかりませんでした (${xhr.status})` 
          });
        }
      };
      
      xhr.onerror = function() {
        console.error('Google Cache検索エラー: ネットワークエラー');
        resolve({ 
          found: false, 
          service: 'Google Cache', 
          error: 'ネットワークエラーが発生しました' 
        });
      };
      
      xhr.ontimeout = function() {
        console.error('Google Cache検索エラー: タイムアウト');
        resolve({ 
          found: false, 
          service: 'Google Cache', 
          error: 'タイムアウトが発生しました' 
        });
      };
      
      xhr.send();
    } catch (error) {
      console.error('Google Cache検索エラー:', error);
      resolve({ found: false, service: 'Google Cache', error: error.message });
    }
  });
}

// 最適なアーカイブを見つける
function findBestArchive(archives) {
  if (archives.length === 0) {
    return null;
  }
  
  // タイムスタンプで並べ替え（最新のものを優先）
  archives.sort((a, b) => {
    // タイムスタンプが数値形式の場合は数値比較
    const aTime = parseInt(a.timestamp.replace(/[^0-9]/g, ''));
    const bTime = parseInt(b.timestamp.replace(/[^0-9]/g, ''));
    return bTime - aTime; // 降順（最新が先頭）
  });
  
  return archives[0];
}

// エラーページを検出して処理する
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // メインフレームのエラーのみを処理
  if (details.frameId !== 0) return;
  
  // 設定を確認
  chrome.storage.sync.get({
    autoArchive: true,
    showNotification: true
  }, (settings) => {
    // 自動アーカイブが無効の場合は何もしない
    if (!settings.autoArchive) return;
    
    const url = details.url;
    
    // 無視すべきURLかどうかを確認
    if (
      url.startsWith('chrome://') || 
      url.startsWith('chrome-extension://') || 
      url.startsWith('file://') ||
      url.startsWith('about:') ||
      url.includes('web.archive.org') ||
      url.includes('archive.is') ||
      url.includes('archive.today') ||
      url.includes('webcitation.org') ||
      url.includes('webcache.googleusercontent.com')
    ) {
      return;
    }
    
    // Wayback Machineを検索
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    
    fetch(apiUrl)
      .then(response => response.json())
      .then(data => {
        if (data.archived_snapshots && data.archived_snapshots.closest) {
          const archiveUrl = data.archived_snapshots.closest.url;
          const timestamp = data.archived_snapshots.closest.timestamp;
          
          // 履歴に追加
          chrome.storage.sync.get({ archiveHistory: [] }, (data) => {
            const history = data.archiveHistory;
            
            // 同じURLのエントリがあれば削除
            const filteredHistory = history.filter(item => item.originalUrl !== url);
            
            // 新しいエントリを追加
            filteredHistory.push({
              originalUrl: url,
              archiveUrl: archiveUrl,
              timestamp: timestamp,
              service: 'Wayback Machine',
              date: new Date().toISOString()
            });
            
            // 履歴が多すぎる場合は古いものを削除（最大50件）
            const trimmedHistory = filteredHistory.slice(-50);
            
            chrome.storage.sync.set({ archiveHistory: trimmedHistory });
          });
          
          // 通知設定が有効な場合
          if (settings.showNotification) {
            // ユーザーに通知して選択させる
            chrome.tabs.update(details.tabId, {
              url: `popup/archive-found.html?original=${encodeURIComponent(url)}&archive=${encodeURIComponent(archiveUrl)}&service=Wayback Machine`
            });
          } else {
            // 通知なしで直接アーカイブページに移動
            chrome.tabs.update(details.tabId, {
              url: archiveUrl
            });
          }
        }
      })
      .catch(error => {
        console.error('アーカイブ検索エラー:', error);
      });
  });
});
