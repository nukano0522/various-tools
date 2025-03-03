// 拡張機能のインストール時に初期設定を行う
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({
    autoArchive: true,
    showNotification: true,
    archiveHistory: []
  }, (items) => {
    // 設定が存在しない場合は初期値を設定
    if (items.autoArchive === undefined) {
      chrome.storage.sync.set({ autoArchive: true });
    }
    if (items.showNotification === undefined) {
      chrome.storage.sync.set({ showNotification: true });
    }
    if (items.archiveHistory === undefined) {
      chrome.storage.sync.set({ archiveHistory: [] });
    }
  });
});

// エラーページを検出して処理する
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  // メインフレームのエラーのみを処理
  if (details.frameId !== 0) return;
  
  // 設定を確認
  const settings = await chrome.storage.sync.get({
    autoArchive: true,
    showNotification: true
  });
  
  // 自動アーカイブが無効の場合は何もしない
  if (!settings.autoArchive) return;
  
  const url = details.url;
  
  // 無視すべきURLかどうかを確認（例：ローカルファイル、拡張機能ページなど）
  if (
    url.startsWith('chrome://') || 
    url.startsWith('chrome-extension://') || 
    url.startsWith('file://') ||
    url.startsWith('about:') ||
    url.includes('web.archive.org')
  ) {
    return;
  }
  
  try {
    // アーカイブURLをチェック
    const archiveResponse = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
    );
    
    if (!archiveResponse.ok) {
      console.error(`アーカイブAPIエラー: ${archiveResponse.status}`);
      return;
    }
    
    const archiveData = await archiveResponse.json();
    
    if (archiveData.archived_snapshots.closest) {
      // アーカイブが見つかった場合
      const archiveUrl = archiveData.archived_snapshots.closest.url;
      const timestamp = archiveData.archived_snapshots.closest.timestamp;
      
      // 履歴に追加
      addToHistory(url, archiveUrl, timestamp);
      
      // 通知設定が有効な場合
      if (settings.showNotification) {
        // ユーザーに通知して選択させる
        chrome.tabs.update(details.tabId, {
          url: `popup/archive-found.html?original=${encodeURIComponent(url)}&archive=${encodeURIComponent(archiveUrl)}`
        });
      } else {
        // 通知なしで直接アーカイブページに移動
        chrome.tabs.update(details.tabId, {
          url: archiveUrl
        });
      }
    } else {
      // アーカイブが見つからない場合、新規作成を試みる
      const saveUrl = `https://web.archive.org/save/${url}`;
      try {
        const saveResponse = await fetch(saveUrl);
        
        if (!saveResponse.ok) {
          console.error(`アーカイブ保存エラー: ${saveResponse.status}`);
          return;
        }
        
        // 保存完了後、数秒待ってからアーカイブを確認
        setTimeout(async () => {
          try {
            const newArchiveResponse = await fetch(
              `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
            );
            
            if (!newArchiveResponse.ok) {
              console.error(`新規アーカイブ確認エラー: ${newArchiveResponse.status}`);
              return;
            }
            
            const newArchiveData = await newArchiveResponse.json();
            if (newArchiveData.archived_snapshots.closest) {
              const newArchiveUrl = newArchiveData.archived_snapshots.closest.url;
              const newTimestamp = newArchiveData.archived_snapshots.closest.timestamp;
              
              // 履歴に追加
              addToHistory(url, newArchiveUrl, newTimestamp);
              
              chrome.tabs.update(details.tabId, {
                url: newArchiveUrl
              });
            }
          } catch (checkError) {
            console.error('新規アーカイブの確認に失敗しました:', checkError);
          }
        }, 5000);
      } catch (saveError) {
        console.error('アーカイブの保存に失敗しました:', saveError);
      }
    }
  } catch (error) {
    console.error('アーカイブ処理中にエラーが発生しました:', error);
  }
});

// 履歴に追加する関数
async function addToHistory(originalUrl, archiveUrl, timestamp) {
  try {
    const data = await chrome.storage.sync.get({ archiveHistory: [] });
    const history = data.archiveHistory;
    
    // 同じURLのエントリがあれば削除
    const filteredHistory = history.filter(item => item.originalUrl !== originalUrl);
    
    // 新しいエントリを追加
    filteredHistory.push({
      originalUrl: originalUrl,
      archiveUrl: archiveUrl,
      timestamp: timestamp,
      date: new Date().toISOString()
    });
    
    // 履歴が多すぎる場合は古いものを削除（最大50件）
    const trimmedHistory = filteredHistory.slice(-50);
    
    await chrome.storage.sync.set({ archiveHistory: trimmedHistory });
  } catch (error) {
    console.error('履歴の保存に失敗しました:', error);
  }
}