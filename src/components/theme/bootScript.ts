export const THEME_STORAGE_KEY = "ff-theme";

/**
 * Runs in <head> before first paint: stored choice, else the system preference. Prevents a theme flash.
 * Lives outside the "use client" theme module so the server layout can inline the string itself.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})()`;
