document.addEventListener('DOMContentLoaded', function() {
  const statusDiv = document.getElementById('status');
  const resultDiv = document.getElementById('result');
  
  // タブ切り替え機能
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      
      // タブのアクティブ状態を切り替え
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // タブコンテンツの表示を切り替え
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabName}-tab`) {
          content.classList.add('active');
        }
      });
    });
  });
  
  // 設定の読み込み
  loadSettings();
  
  // 履歴の読み込み
  loadHistory();
  
  // 現在のページをチェック
  document.getElementById('checkArchive').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url;
    
    setStatus('loading', 'アーカイブを確認中...');
    
    try {
      const response = await fetch(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.archived_snapshots.closest) {
        const archiveUrl = data.archived_snapshots.closest.url;
        const timestamp = data.archived_snapshots.closest.timestamp;
        
        setStatus('success', 'アーカイブが見つかりました！');
        
        resultDiv.innerHTML = `
          <p>アーカイブが見つかりました！</p>
          <p>日時: ${formatTimestamp(timestamp)}</p>
          <a href="${archiveUrl}" target="_blank">アーカイブを表示</a>
        `;
        
        // 履歴に追加
        addToHistory(url, archiveUrl, timestamp);
      } else {
        setStatus('error', 'アーカイブが見つかりませんでした。');
        resultDiv.textContent = 'アーカイブが見つかりませんでした。';
      }
    } catch (error) {
      setStatus('error', 'エラーが発生しました。');
      console.error('Error checking archive:', error);
    }
  });
  
  // 現在のページをアーカイブ
  document.getElementById('saveArchive').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url;
    
    setStatus('loading', 'ページをアーカイブ中...');
    
    try {
      const saveUrl = `https://web.archive.org/save/${url}`;
      const response = await fetch(saveUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      setStatus('success', 'アーカイブを保存しました！');
      
      // 保存後、アーカイブを確認
      setTimeout(async () => {
        try {
          const checkResponse = await fetch(
            `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
          );
          const data = await checkResponse.json();
          
          if (data.archived_snapshots.closest) {
            const archiveUrl = data.archived_snapshots.closest.url;
            const timestamp = data.archived_snapshots.closest.timestamp;
            
            resultDiv.innerHTML = `
              <p>新しいアーカイブが作成されました！</p>
              <p>日時: ${formatTimestamp(timestamp)}</p>
              <a href="${archiveUrl}" target="_blank">アーカイブを表示</a>
            `;
            
            // 履歴に追加
            addToHistory(url, archiveUrl, timestamp);
          }
        } catch (error) {
          console.error('Error checking new archive:', error);
        }
      }, 5000);
    } catch (error) {
      setStatus('error', 'アーカイブの保存に失敗しました。');
      console.error('Error saving archive:', error);
    }
  });
  
  // 設定を保存
  document.getElementById('saveSettings').addEventListener('click', () => {
    const autoArchive = document.getElementById('autoArchive').checked;
    const showNotification = document.getElementById('showNotification').checked;
    
    chrome.storage.sync.set({
      autoArchive: autoArchive,
      showNotification: showNotification
    }, () => {
      setStatus('success', '設定を保存しました！');
      setTimeout(() => {
        setStatus('', '');
      }, 2000);
    });
  });
  
  // 履歴をクリア
  document.getElementById('clearHistory').addEventListener('click', () => {
    chrome.storage.sync.set({ archiveHistory: [] }, () => {
      document.getElementById('history-list').innerHTML = '<div class="archive-item">履歴がありません</div>';
      setStatus('success', '履歴をクリアしました！');
      setTimeout(() => {
        setStatus('', '');
      }, 2000);
    });
  });
});

// ステータス表示を更新
function setStatus(type, message) {
  const statusDiv = document.getElementById('status');
  statusDiv.className = type ? type : '';
  statusDiv.textContent = message;
}

// タイムスタンプをフォーマット
function formatTimestamp(timestamp) {
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  return `${year}年${month}月${day}日`;
}

// 設定を読み込む
function loadSettings() {
  chrome.storage.sync.get({
    autoArchive: true,
    showNotification: true
  }, (items) => {
    document.getElementById('autoArchive').checked = items.autoArchive;
    document.getElementById('showNotification').checked = items.showNotification;
  });
}

// 履歴を読み込む
function loadHistory() {
  chrome.storage.sync.get({ archiveHistory: [] }, (items) => {
    const historyList = document.getElementById('history-list');
    
    if (items.archiveHistory.length === 0) {
      historyList.innerHTML = '<div class="archive-item">履歴がありません</div>';
      return;
    }
    
    historyList.innerHTML = '';
    
    // 最新の10件のみ表示
    const recentHistory = items.archiveHistory.slice(-10).reverse();
    
    recentHistory.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'archive-item';
      
      const urlParts = new URL(item.originalUrl);
      const displayUrl = urlParts.hostname + urlParts.pathname.substring(0, 15) + (urlParts.pathname.length > 15 ? '...' : '');
      
      historyItem.innerHTML = `
        <div>${displayUrl}</div>
        <div class="archive-date">${formatTimestamp(item.timestamp)}</div>
        <a href="${item.archiveUrl}" target="_blank">アーカイブを表示</a>
      `;
      
      historyList.appendChild(historyItem);
    });
  });
}

// 履歴に追加
function addToHistory(originalUrl, archiveUrl, timestamp) {
  chrome.storage.sync.get({ archiveHistory: [] }, (items) => {
    const history = items.archiveHistory;
    
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
    
    chrome.storage.sync.set({ archiveHistory: trimmedHistory }, () => {
      // 履歴タブが表示されている場合は更新
      if (document.getElementById('history-tab').classList.contains('active')) {
        loadHistory();
      }
    });
  });
} 