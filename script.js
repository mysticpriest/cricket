
/* ==========================================
   CRICKET - MAIN APPLICATION
   ========================================== */

const loader = document.getElementById("loader");
const progress = document.getElementById("progress");
const percent = document.getElementById("percent");
const statusText = document.getElementById("status");
const app = document.getElementById("app");
const notice = document.getElementById("notice");

const LOADING_DURATION = 2900;

let loadingStart = null;

/* ==========================================
   LOADING ANIMATION
   ========================================== */

function animateLoading(timestamp) {
    if (loadingStart === null) {
        loadingStart = timestamp;
    }

    const elapsed = timestamp - loadingStart;
    const timeProgress = Math.min(
        elapsed / LOADING_DURATION,
        1
    );

    const easedProgress = 1 - Math.pow(
        1 - timeProgress,
        2.2
    );

    const value = Math.round(easedProgress * 100);

    progress.style.width = value + "%";
    percent.textContent = value + "%";

    if (value < 35) {
        statusText.textContent = "Initializing workspace";
    } else if (value < 70) {
        statusText.textContent = "Preparing departments";
    } else if (value < 99) {
        statusText.textContent = "Almost ready";
    } else {
        statusText.textContent = "Workspace ready";
    }

    if (timeProgress < 1) {
        requestAnimationFrame(animateLoading);
    } else {
        finishLoading();
    }
}

function finishLoading() {
    setTimeout(() => {
        app.classList.add("visible");
        loader.classList.add("done");

        setTimeout(() => {
            loader.remove();
        }, 800);
    }, 260);
}

requestAnimationFrame(animateLoading);

/* ==========================================
   DEPARTMENT NAVIGATION
   ========================================== */

const departmentButtons = document.querySelectorAll(
    ".department"
);

departmentButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const departmentName = button.dataset.name;
        openDepartment(departmentName);
    });
});

function openDepartment(departmentName) {
    switch (departmentName) {
        case "Inbound":
            window.location.href = "inbound.html";
            break;

        case "Outbound":
            notice.textContent =
                "Outbound workspace is coming soon.";
            break;

        case "Case Management":
            notice.textContent =
                "Case Management workspace is coming soon.";
            break;

        default:
            notice.textContent =
                "This workspace is currently unavailable.";
    }
}
