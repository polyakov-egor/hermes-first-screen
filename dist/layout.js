(() => {
  const resizeScene = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1000);
    document.documentElement.style.setProperty("--scene-scale", String(scale));
  };
  resizeScene();
  window.addEventListener("resize", resizeScene, { passive: true });
})();
