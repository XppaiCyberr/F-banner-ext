const jsonUrl = "https://raw.githubusercontent.com/XppaiCyberr/farcaster-banner/refs/heads/main/banner.json";
let currentUsername = null;
let banners = null;
let lastUrl = window.location.href;
let urlCheckTimeout = null;

function getUsernameFromURL() {
  const match = window.location.pathname.match(/^\/([^\/?#]+)/);
  return match ? match[1] : null;
}

async function getCachedBanner(username) {
  try {
    const result = await chrome.storage.local.get(`banner_${username}`);
    return result[`banner_${username}`] || null;
  } catch (error) {
    console.warn('Failed to get cached banner:', error);
    return null;
  }
}

async function setCachedBanner(username, url, dataUrl) {
  const cacheData = {
    url: url,
    dataUrl: dataUrl,
    timestamp: Date.now()
  };
  try {
    await chrome.storage.local.set({ [`banner_${username}`]: cacheData });
  } catch (error) {
    console.warn('Failed to cache banner:', error);
  }
}

function downloadAndCacheBanner(username, imgUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = function() {
      // Convert to base64 for storage
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setCachedBanner(username, imgUrl, dataUrl);
        resolve(dataUrl);
      } catch (error) {
        console.warn('Failed to cache banner:', error);
        resolve(imgUrl); // Fallback to original URL
      }
    };
    
    img.onerror = function() {
      console.warn('Failed to load banner image:', imgUrl);
      resolve(imgUrl); // Fallback to original URL
    };
    
    img.src = imgUrl;
  });
}

async function replaceBanner(username, imgUrl) {
  // Look for either the original banner div or the custom banner img
  const originalTarget = document.querySelector("#body\\:main > div.relative.h-\\[200px\\].overflow-hidden.bg-light-purple");
  const customTarget = document.querySelector("#body\\:main img[alt='Custom Banner']");
  const target = originalTarget || customTarget;

  if (target && imgUrl) {
    let finalImgSrc = imgUrl;
    
    // Check storage first
    const cached = await getCachedBanner(username);
    
    if (cached && cached.url === imgUrl) {
      // Use cached version
      finalImgSrc = cached.dataUrl;
      console.log('Using cached banner for:', username);
    } else {
      // Download and cache new banner
      console.log('Downloading new banner for:', username);
      finalImgSrc = await downloadAndCacheBanner(username, imgUrl);
    }
    
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "Custom Banner";
    img.className = "aspect-[3/1] size-full object-cover object-center";
    img.src = finalImgSrc;
    target.replaceWith(img);
    return true;
  }

  return false;
}

function tryReplace(username) {
  const imgUrl = banners?.[username];
  
  if (!imgUrl) {
    // No custom banner for this user - restore original banner
    restoreOriginalBanner();
    return;
  }
  
  replaceBanner(username, imgUrl).then(success => {
    if (!success) {
      // More targeted observer - only watch for the specific banner container
      const observer = new MutationObserver((mutations) => {
        // Only check if banner-related changes occurred
        const hasRelevantChange = mutations.some(mutation => 
          mutation.type === 'childList' && 
          (mutation.target.id === 'body:main' || mutation.target.closest('#body\\:main'))
        );
        
        if (hasRelevantChange) {
          // Check if we can find a target now
          const originalTarget = document.querySelector("#body\\:main > div.relative.h-\\[200px\\].overflow-hidden.bg-light-purple");
          const customTarget = document.querySelector("#body\\:main img[alt='Custom Banner']");
          
          if (originalTarget || customTarget) {
            replaceBanner(username, imgUrl).then(replaced => {
              if (replaced) observer.disconnect();
            });
          }
        }
      });
      
      // Only observe the main content area, not the entire body
      const mainContent = document.querySelector('#body\\:main') || document.body;
      observer.observe(mainContent, { childList: true, subtree: true });
    }
  });
}

function restoreOriginalBanner() {
  // Look for any existing custom banner (img element) and remove it
  const existingCustomBanner = document.querySelector('#body\\:main img[alt="Custom Banner"]');
  if (existingCustomBanner) {
    // Create the original banner div element
    const originalBanner = document.createElement('div');
    originalBanner.className = 'relative h-[200px] overflow-hidden bg-light-purple';
    
    existingCustomBanner.replaceWith(originalBanner);
    console.log('Restored original banner for user without custom banner');
    return true;
  }
  
  // Also set up observer in case the banner area isn't loaded yet
  const observer = new MutationObserver(() => {
    const customBanner = document.querySelector('#body\\:main img[alt="Custom Banner"]');
    if (customBanner) {
      const originalBanner = document.createElement('div');
      originalBanner.className = 'relative h-[200px] overflow-hidden bg-light-purple';
      customBanner.replaceWith(originalBanner);
      observer.disconnect();
      console.log('Restored original banner for user without custom banner');
    }
  });
  
  const mainContent = document.querySelector('#body\\:main') || document.body;
  observer.observe(mainContent, { childList: true, subtree: true });
  
  // Disconnect observer after 3 seconds to prevent it from running indefinitely
  setTimeout(() => observer.disconnect(), 3000);
  
  return false;
}

function checkUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    const newUsername = getUsernameFromURL();
    
    if (newUsername && newUsername !== currentUsername) {
      currentUsername = newUsername;
      tryReplace(currentUsername);
      console.log("URL changed - replaced banner for:", currentUsername);
    }
  }
}

function monitorURLChange() {
  // Use a more efficient approach with throttled checking
  const throttledCheck = () => {
    if (urlCheckTimeout) clearTimeout(urlCheckTimeout);
    urlCheckTimeout = setTimeout(checkUrlChange, 100); // Throttle to 100ms
  };

  // Listen for navigation events
  window.addEventListener('popstate', throttledCheck);
  
  // Backup observer with reduced sensitivity
  const observer = new MutationObserver(throttledCheck);
  
  // Only observe navigation-related changes
  observer.observe(document.querySelector('head title') || document.head, { 
    childList: true, 
    subtree: true,
    characterData: true 
  });
}

// Initial fetch + setup
fetch(jsonUrl)
  .then(res => res.json())
  .then(json => {
    banners = json;
    currentUsername = getUsernameFromURL();
    if (currentUsername) tryReplace(currentUsername);
    monitorURLChange();
    console.log("Extension loaded for:", currentUsername);
  })
  .catch(err => console.error("Failed to load banners JSON:", err));
