function notify(message, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type} slide-down`;
  const icons = { success: "check-circle", error: "x-circle", warning: "alert-triangle", info: "info" };
  toast.innerHTML = `
    <i data-lucide="${icons[type] || "info"}"></i>
    <span>${message}</span>
    <button class="toast-close" aria-label="Close">&times;</button>`;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons({ nodes: [toast] });

  const remove = () => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  };
  toast.querySelector(".toast-close").addEventListener("click", remove);
  setTimeout(remove, duration);
}

window.notify = notify;
