const jsonUrl = "https://raw.githubusercontent.com/XppaiCyberr/farcaster-banner/refs/heads/main/banner.json";
let currentUsername = null;
let banners = null;
let lastUrl = window.location.href;
let urlCheckTimeout = null;

// IndexedDB setup for blob storage
const DB_NAME = 'BannerCache';
const DB_VERSION = 1;
const STORE_NAME = 'banners';

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'username' });
      }
    };
  });
}

function getUsernameFromURL() {
  const match = window.location.pathname.match(/^\/([^\/?#]+)/);
  return match ? match[1] : null;
}

function isValidImageUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

async function getCachedBanner(username) {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get(username);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.blob) {
          // Create object URL from cached blob
          const objectUrl = URL.createObjectURL(result.blob);
          resolve({
            url: result.originalUrl,
            dataUrl: objectUrl,
            timestamp: result.timestamp,
            isBlob: true
          });
        } else {
          resolve(null);
        }
      };
    });
  } catch (error) {
    console.warn('Failed to get cached banner:', error);
    return null;
  }
}

async function setCachedBanner(username, url, blob) {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const cacheData = {
      username: username,
      originalUrl: url,
      blob: blob,
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(cacheData);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.warn('Failed to cache banner:', error);
  }
}

function downloadAndCacheBanner(username, imgUrl) {
  return new Promise((resolve, reject) => {
    // First, try to fetch the image to check if it's accessible
    fetch(imgUrl, { mode: 'cors' })
      .then(response => {
        if (!response.ok) throw new Error('Fetch failed');
        return response.blob();
      })
      .then(async (blob) => {
        // Successfully fetched as blob, cache it directly
        try {
          await setCachedBanner(username, imgUrl, blob);
          const objectUrl = URL.createObjectURL(blob);
          console.log('Successfully cached banner via fetch for:', username);
          resolve(objectUrl);
        } catch (error) {
          console.warn('Failed to cache fetched banner:', error);
          resolve(imgUrl);
        }
      })
      .catch(() => {
        // Fetch failed, try with Image element approach
        console.log('Fetch failed, trying Image element approach for:', imgUrl);
        
        const img = new Image();
        
        // Try without crossOrigin first
        img.onload = function() {
          try {
            // Try to create canvas with crossOrigin
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            // Convert to blob
            canvas.toBlob(async (blob) => {
              try {
                await setCachedBanner(username, imgUrl, blob);
                const objectUrl = URL.createObjectURL(blob);
                console.log('Successfully cached banner via canvas for:', username);
                resolve(objectUrl);
              } catch (error) {
                console.warn('Failed to cache canvas banner:', error);
                resolve(imgUrl);
              }
            }, 'image/jpeg', 0.8);
          } catch (canvasError) {
            // Canvas failed due to CORS, just use original URL
            console.log('Canvas conversion failed due to CORS, using original URL for:', username);
            resolve(imgUrl);
          }
        };
        
        img.onerror = function() {
          console.warn('Failed to load banner image completely:', imgUrl);
          // Try one more time with crossOrigin
          const corsImg = new Image();
          corsImg.crossOrigin = 'anonymous';
          
          corsImg.onload = function() {
            try {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              canvas.width = corsImg.width;
              canvas.height = corsImg.height;
              ctx.drawImage(corsImg, 0, 0);
              
              canvas.toBlob(async (blob) => {
                try {
                  await setCachedBanner(username, imgUrl, blob);
                  const objectUrl = URL.createObjectURL(blob);
                  console.log('Successfully cached banner with CORS for:', username);
                  resolve(objectUrl);
                } catch (error) {
                  console.warn('Failed to cache CORS banner:', error);
                  resolve(imgUrl);
                }
              }, 'image/jpeg', 0.8);
            } catch (corsError) {
              console.log('CORS image also failed, using original URL for:', username);
              resolve(imgUrl);
            }
          };
          
          corsImg.onerror = function() {
            console.log('All image loading methods failed, using original URL for:', username);
            resolve(imgUrl);
          };
          
          corsImg.src = imgUrl;
        };
        
        img.src = imgUrl;
      });
  });
}

async function replaceBanner(username, imgUrl) {
  // Look for either the original banner div or the custom banner img
  const originalTarget = document.querySelector("#body\\:main > div.relative.h-\\[200px\\].overflow-hidden.bg-light-purple");
  const customTarget = document.querySelector("#body\\:main img[alt='Custom Banner']");
  const target = originalTarget || customTarget;

  if (target && imgUrl) {
    let finalImgSrc = imgUrl;
    let shouldRevokeUrl = false;
    
    try {
      // Check storage first
      const cached = await getCachedBanner(username);
      
      if (cached && cached.url === imgUrl) {
        // Use cached version
        finalImgSrc = cached.dataUrl;
        shouldRevokeUrl = cached.isBlob; // Only revoke if it's a blob URL
        console.log('Using cached banner for:', username);
      } else {
        // Download and cache new banner
        console.log('Downloading new banner for:', username);
        finalImgSrc = await downloadAndCacheBanner(username, imgUrl);
        shouldRevokeUrl = finalImgSrc.startsWith('blob:'); // Check if it's a blob URL
      }
    } catch (error) {
      console.warn('Error in banner processing, using original URL:', error);
      finalImgSrc = imgUrl; // Fallback to original URL
    }
    
    // Clean up previous blob URL if exists
    const existingImg = document.querySelector("#body\\:main img[alt='Custom Banner']");
    if (existingImg && existingImg.src.startsWith('blob:')) {
      URL.revokeObjectURL(existingImg.src);
    }
    
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "Custom Banner";
    img.className = "aspect-[3/1] size-full object-cover object-center";
    img.src = finalImgSrc;
    
    // Add cleanup when image is no longer needed
    if (shouldRevokeUrl) {
      img.addEventListener('load', () => {
        // Set a timeout to revoke the URL after the image is loaded and displayed
        setTimeout(() => {
          if (img.src.startsWith('blob:') && !document.contains(img)) {
            URL.revokeObjectURL(img.src);
          }
        }, 1000);
      });
    }
    
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
  
  if (!isValidImageUrl(imgUrl)) {
    console.warn('Invalid image URL for user:', username, imgUrl);
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

function cleanupBlobUrls() {
  // Clean up any blob URLs when navigating away
  const customBanners = document.querySelectorAll('#body\\:main img[alt="Custom Banner"]');
  customBanners.forEach(img => {
    if (img.src.startsWith('blob:')) {
      URL.revokeObjectURL(img.src);
    }
  });
}

function monitorURLChange() {
  // Use a more efficient approach with throttled checking
  const throttledCheck = () => {
    if (urlCheckTimeout) clearTimeout(urlCheckTimeout);
    urlCheckTimeout = setTimeout(() => {
      cleanupBlobUrls(); // Clean up before checking URL change
      checkUrlChange();
    }, 100); // Throttle to 100ms
  };

  // Listen for navigation events
  window.addEventListener('popstate', throttledCheck);
  window.addEventListener('beforeunload', cleanupBlobUrls);
  
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
