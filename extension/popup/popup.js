// DOM要素が読み込まれたら実行
document.addEventListener('DOMContentLoaded', () => {
  // 検索フラグをリセット
  resetSearchFlag();
  
  // タブ切り替え
  setupTabs();
  
  // 初期タブを表示
  showTab('main');
  
  // 現在のページをチェック
  document.getElementById('checkArchive').addEventListener('click', checkCurrentPage);
  
  // 設定の読み込み
  loadSettings();
  
  // 履歴の読み込み
  loadHistory();
});

// 検索フラグをリセット
function resetSearchFlag() {
  chrome.runtime.sendMessage({ action: 'resetSearchFlag' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('検索フラグのリセットエラー:', chrome.runtime.lastError);
      return;
    }
    console.log('検索フラグをリセットしました');
  });
}

// タブ切り替えの設定
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      showTab(tabId);
    });
  });
}

// タブを表示
function showTab(tabId) {
  // すべてのタブコンテンツを非表示
  const tabContents = document.querySelectorAll('.tab-content');
  tabContents.forEach(content => {
    content.style.display = 'none';
  });
  
  // すべてのタブを非アクティブ
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.classList.remove('active');
  });
  
  // 選択されたタブとコンテンツを表示
  document.getElementById(tabId).style.display = 'block';
  document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add('active');
  
  // タブに応じた追加処理
  if (tabId === 'settings') {
    loadSettings();
  } else if (tabId === 'history') {
    loadHistory();
  }
}

// 現在のページをチェック
async function checkCurrentPage() {
  try {
    // ステータスをリセット
    setStatus('loading', 'アーカイブを確認中...');
    document.getElementById('result').innerHTML = '';
    
    // 現在のタブのURLを取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url;
    
    // URLの検証
    if (!url || !url.startsWith('http')) {
      setStatus('error', '有効なURLではありません');
      return;
    }
    
    // 設定を取得
    const settings = await chrome.storage.sync.get({
      enabledArchives: {
        waybackMachine: true,
        archiveToday: false,
        googleCache: true,
        memento: false
      }
    });
    
    // 少なくとも1つのサービスが有効か確認
    const hasEnabledService = Object.values(settings.enabledArchives).some(enabled => enabled);
    if (!hasEnabledService) {
      setStatus('error', '少なくとも1つのアーカイブサービスを有効にしてください');
      return;
    }
    
    // 検索前に検索フラグをリセット
    resetSearchFlag();
    
    // バックグラウンドスクリプトにメッセージを送信
    chrome.runtime.sendMessage(
      { 
        action: 'searchArchives', 
        url: url, 
        enabledArchives: settings.enabledArchives 
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('メッセージ送信エラー:', chrome.runtime.lastError);
          setStatus('error', `エラー: ${chrome.runtime.lastError.message || 'メッセージ送信に失敗しました'}`);
          return;
        }
        
        if (!response) {
          setStatus('error', 'レスポンスがありません');
          return;
        }
        
        if (!response.success) {
          setStatus('error', `エラー: ${response.error || '不明なエラー'}`);
          return;
        }
        
        if (response.processing) {
          // 処理中の場合はポーリングを開始
          startPolling(url);
        }
      }
    );
  } catch (error) {
    console.error('チェック中にエラーが発生しました:', error);
    setStatus('error', `エラー: ${error.message || '不明なエラー'}`);
    
    // エラー発生時に検索フラグをリセット
    resetSearchFlag();
  }
}

// 結果をポーリングで取得
function startPolling(url) {
  let attempts = 0;
  const maxAttempts = 10;
  const interval = 500; // 500ミリ秒ごとに確認
  
  const pollTimer = setInterval(() => {
    attempts++;
    
    if (attempts > maxAttempts) {
      clearInterval(pollTimer);
      setStatus('error', 'タイムアウト: 応答を受信できませんでした');
      return;
    }
    
    chrome.runtime.sendMessage({ action: 'getLastSearchResult' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('ポーリングエラー:', chrome.runtime.lastError);
        return;
      }
      
      if (!response || !response.success) {
        return; // まだ結果がない
      }
      
      const searchResult = response.data;
      
      // 現在のURLと一致するか確認
      if (searchResult.url !== url) {
        return; // 別のURLの結果
      }
      
      // ポーリング停止
      clearInterval(pollTimer);
      
      // エラーがあるか確認
      if (searchResult.error) {
        setStatus('error', `エラー: ${searchResult.error}`);
        return;
      }
      
      // 結果を表示
      displaySearchResult(searchResult.result, url);
    });
  }, interval);
}

// 検索結果を表示
function displaySearchResult(results, url) {
  if (results.found) {
    // アーカイブが見つかった場合
    setStatus('success', 'アーカイブが見つかりました！');
    
    // 結果を表示
    const resultElement = document.getElementById('result');
    resultElement.innerHTML = '';
    
    // 最適なアーカイブを取得
    const bestArchive = results.bestArchive || results;
    const serviceClass = getServiceClass(bestArchive.service);
    
    // アーカイブ情報を表示
    resultElement.innerHTML = `
      <div class="archive-item ${serviceClass}">
        <div class="archive-service ${serviceClass}">${bestArchive.service}</div>
        <div class="archive-date">${formatTimestamp(bestArchive.timestamp)}</div>
        <p>アクセスしようとしたページは現在利用できませんが、Web Archiveに保存されたバージョンが見つかりました。</p>
        <div class="archive-actions">
          <button id="viewArchiveBtn" class="primary-button">アーカイブを表示</button>
          <button id="viewOriginalBtn" class="secondary-button">元のページを再訪問</button>
        </div>
      </div>
    `;
    
    // ボタンにイベントリスナーを追加
    document.getElementById('viewArchiveBtn').addEventListener('click', () => {
      // 新しいタブでアーカイブを開く
      chrome.tabs.create({ url: bestArchive.url });
      // ポップアップを閉じる
      window.close();
    });
    
    document.getElementById('viewOriginalBtn').addEventListener('click', () => {
      // 元のページを開く
      chrome.tabs.create({ url: url });
      // ポップアップを閉じる
      window.close();
    });
    
    // 履歴に追加
    chrome.runtime.sendMessage({
      action: 'addToHistory',
      originalUrl: url,
      archiveUrl: bestArchive.url,
      timestamp: bestArchive.timestamp,
      service: bestArchive.service
    });
  } else {
    // アーカイブが見つからなかった場合
    setStatus('warning', 'アーカイブが見つかりませんでした');
    
    // エラーメッセージがある場合は表示
    let errorMessage = '';
    if (results.error) {
      errorMessage = `<p class="error-details"><strong>${results.service}:</strong> ${results.error}</p>`;
    } else if (results.errors && results.errors.length > 0) {
      errorMessage = '<div class="error-details">';
      results.errors.forEach(error => {
        errorMessage += `<p><strong>${error.service}:</strong> ${error.error}</p>`;
      });
      errorMessage += '</div>';
    }
    
    // Wayback Machineで新規作成するリンクを表示
    const resultElement = document.getElementById('result');
    resultElement.innerHTML = `
      <div class="no-archive">
        <p>このページのアーカイブは見つかりませんでした。</p>
        ${errorMessage}
        <button id="createArchiveBtn" class="primary-button">Wayback Machineで保存する</button>
        <button id="tryOriginalBtn" class="secondary-button">元のページを再訪問</button>
      </div>
    `;
    
    // 保存ボタンにイベントリスナーを追加
    document.getElementById('createArchiveBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: `https://web.archive.org/save/${url}` });
      window.close();
    });
    
    // 元のページボタンにイベントリスナーを追加
    document.getElementById('tryOriginalBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: url });
      window.close();
    });
  }
}

// サービス名からCSSクラス名を取得
function getServiceClass(serviceName) {
  switch (serviceName) {
    case 'Wayback Machine':
      return 'wayback';
    case 'Google Cache':
      return 'google';
    default:
      return '';
  }
}

// ステータスを設定
function setStatus(type, message) {
  const statusElement = document.getElementById('status');
  statusElement.className = `status ${type}`;
  statusElement.textContent = message;
}

// タイムスタンプをフォーマット
function formatTimestamp(timestamp) {
  if (!timestamp) return '不明な日時';
  
  try {
    // YYYYMMDDhhmmss 形式を解析
    if (timestamp.includes('T')) {
      // ISO形式の場合
      const date = new Date(timestamp);
      return date.toLocaleString('ja-JP');
    } else {
      // YYYYMMDDhhmmss 形式の場合
      const year = timestamp.substring(0, 4);
      const month = timestamp.substring(4, 6);
      const day = timestamp.substring(6, 8);
      const hour = timestamp.substring(8, 10);
      const minute = timestamp.substring(10, 12);
      const second = timestamp.substring(12, 14);
      
      return `${year}年${month}月${day}日 ${hour}:${minute}:${second}`;
    }
  } catch (e) {
    console.error('タイムスタンプのフォーマットエラー:', e);
    return timestamp; // 解析できない場合はそのまま返す
  }
}

// 設定を読み込む
function loadSettings() {
  chrome.storage.sync.get({
    autoArchive: true,
    showNotification: true,
    enabledArchives: {
      waybackMachine: true,
      archiveToday: false,
      googleCache: true,
      memento: false
    }
  }, (items) => {
    // 自動アーカイブの設定
    document.getElementById('autoArchive').checked = items.autoArchive;
    
    // 通知の設定
    document.getElementById('showNotification').checked = items.showNotification;
    
    // アーカイブサービスの設定
    document.getElementById('waybackMachine').checked = items.enabledArchives.waybackMachine;
    document.getElementById('googleCache').checked = items.enabledArchives.googleCache;
    
    // 他のサービスは無効化して表示
    const otherServices = ['archiveToday', 'memento'];
    otherServices.forEach(service => {
      const checkbox = document.getElementById(service);
      checkbox.checked = false;
      checkbox.disabled = true;
      checkbox.parentElement.classList.add('disabled');
      checkbox.parentElement.title = '現在このサービスは利用できません';
    });
    
    // Google Cacheのチェックボックスを有効化
    const googleCacheCheckbox = document.getElementById('googleCache');
    googleCacheCheckbox.disabled = false;
    googleCacheCheckbox.parentElement.classList.remove('disabled');
    googleCacheCheckbox.parentElement.title = '';
    
    // 設定保存ボタンのイベントリスナー
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    
    // 自動アーカイブと通知の設定変更イベント
    document.getElementById('autoArchive').addEventListener('change', saveSettings);
    document.getElementById('showNotification').addEventListener('change', saveSettings);
    
    // アーカイブサービスの設定変更イベント
    document.getElementById('waybackMachine').addEventListener('change', (e) => {
      validateArchiveServices(e.target);
    });
    
    document.getElementById('googleCache').addEventListener('change', (e) => {
      validateArchiveServices(e.target);
    });
  });
}

// アーカイブサービスの選択を検証
function validateArchiveServices(changedCheckbox) {
  const waybackMachine = document.getElementById('waybackMachine');
  const googleCache = document.getElementById('googleCache');
  
  // 少なくとも1つのサービスが有効になっているか確認
  if (!waybackMachine.checked && !googleCache.checked) {
    // 変更されたチェックボックスを再度チェック
    changedCheckbox.checked = true;
    alert('少なくとも1つのアーカイブサービスを有効にしてください');
  }
  
  // 設定を保存
  saveSettings();
}

// 設定を保存
function saveSettings() {
  const autoArchive = document.getElementById('autoArchive').checked;
  const showNotification = document.getElementById('showNotification').checked;
  const waybackMachine = document.getElementById('waybackMachine').checked;
  const googleCache = document.getElementById('googleCache').checked;
  
  chrome.storage.sync.set({
    autoArchive: autoArchive,
    showNotification: showNotification,
    enabledArchives: {
      waybackMachine: waybackMachine,
      archiveToday: false,
      googleCache: googleCache,
      memento: false
    }
  }, () => {
    // 保存完了メッセージ
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.textContent = '設定を保存しました';
    saveStatus.style.display = 'block';
    
    // 3秒後にメッセージを消す
    setTimeout(() => {
      saveStatus.style.display = 'none';
    }, 3000);
  });
}

// 履歴を読み込む
function loadHistory() {
  chrome.storage.sync.get({ archiveHistory: [] }, (data) => {
    const historyElement = document.getElementById('historyList');
    historyElement.innerHTML = '';
    
    const history = data.archiveHistory;
    
    if (history.length === 0) {
      historyElement.innerHTML = '<div class="no-history">履歴はありません</div>';
      return;
    }
    
    // 新しい順に並べ替え
    history.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 履歴を表示
    history.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      
      // URLを短く表示
      const displayUrl = item.originalUrl.length > 40 
        ? item.originalUrl.substring(0, 40) + '...' 
        : item.originalUrl;
      
      // サービスに応じたクラスを取得
      const serviceClass = getServiceClass(item.service);
      
      historyItem.innerHTML = `
        <div class="history-url" title="${item.originalUrl}">${displayUrl}</div>
        <div class="history-info">
          <span class="history-service ${serviceClass}">${item.service}</span>
          <span class="history-date">${formatTimestamp(item.timestamp)}</span>
        </div>
        <div class="history-actions">
          <a href="${item.archiveUrl}" target="_blank" class="history-link">開く</a>
        </div>
      `;
      
      historyElement.appendChild(historyItem);
    });
    
    // 履歴クリアボタンのイベントリスナー
    document.getElementById('clearHistory').addEventListener('click', clearHistory);
  });
}

// 履歴をクリア
function clearHistory() {
  if (confirm('履歴を全て削除しますか？')) {
    chrome.storage.sync.set({ archiveHistory: [] }, () => {
      loadHistory(); // 履歴を再読み込み
    });
  }
} 