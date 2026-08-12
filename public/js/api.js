// async function apiFetch(url, options = {}) {

//     const token = localStorage.getItem("token");

//     if (!token) {
//         window.location.href = "login.html";
//         return;
//     }

//     const defaultHeaders = {
//         "Authorization": "Bearer " + token
//     };

//     // If body is JSON, attach content-type
//     if (options.body && !(options.body instanceof FormData)) {
//         defaultHeaders["Content-Type"] = "application/json";
//     }

//     options.headers = {
//         ...defaultHeaders,
//         ...options.headers
//     };

//     const response = await fetch(url, options);

//     if (response.status === 401 || response.status === 403) {
//         localStorage.clear();
//         window.location.href = "login.html";
//         return;
//     }

//     return response;
// }

async function apiFetch(url, options = {}) {

    const token = localStorage.getItem("token");

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const defaultHeaders = {
        "Authorization": "Bearer " + token
    };

    if (options.body && !(options.body instanceof FormData)) {
        defaultHeaders["Content-Type"] = "application/json";
    }

    options.headers = {
        ...defaultHeaders,
        ...options.headers
    };

    const response = await fetch(url, options);

    if (response.status === 401) {
        localStorage.clear();
        window.location.href = "login.html";
        return;
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.detail || data.message || "Request failed");
    }

    return data;
}