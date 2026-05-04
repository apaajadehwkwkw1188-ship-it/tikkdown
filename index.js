import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import chalk from "chalk";
import { fileURLToPath } from "url";

const app = express();

// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
const BLOCK_FILE = path.join("/tmp", "blocked-ips.json");
const BOT_IP_WHITELIST = ["127.0.0.1", "::1"];

const MASTER_FP = "TW96aWxsYS81LjAgKExpbnV4OyBBbmRyb2lkIDEwOyBLKSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTM5LjAuMC4wIE1vYmlsZSBTYWZhcmkvNTM3LjM2MzYwQXNpYS9KYWthcnRh";

// 🔥 PENTING (ini tadi lu lupa)
const BASE_URL = "https://v1-tikkdown.vercel.app";

// =======================
let blockedIPs = new Set();

function loadBlockedIPs() {
    try {
        if (fs.existsSync(BLOCK_FILE)) {
            const data = JSON.parse(fs.readFileSync(BLOCK_FILE));
            blockedIPs = new Set(data);
        }
    } catch {
        blockedIPs = new Set();
    }
}

function saveBlockedIPs() {
    fs.writeFileSync(BLOCK_FILE, JSON.stringify([...blockedIPs]));
}

loadBlockedIPs();

// =======================
app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// =======================
// ROOT
// =======================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =======================
// API DOCS
// =======================
app.get("/api", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "api-docs.html"));
});
app.get("/ytshorts", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "ytshorts.html"));
});

// =======================
// BLOCK CHECK
// =======================
app.use((req, res, next) => {
    const ip = req.ip.replace("::ffff:", "");

    if (BOT_IP_WHITELIST.includes(ip)) return next();

    if (blockedIPs.has(ip)) {
        return res.status(403).json({
            status: false,
            error: "IP Blocked"
        });
    }

    next();
});

// =======================
// RATE LIMIT
// =======================
const globalLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 30,
    handler: (req, res) => {
        const ip = req.ip.replace("::ffff:", "");

        if (!blockedIPs.has(ip) && !BOT_IP_WHITELIST.includes(ip)) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(chalk.red(`🚫 BLOCKED: ${ip}`));
        }

        res.status(429).json({
            status: false,
            error: "Too Many Requests"
        });
    }
});

app.use((req, res, next) => {
    const ip = req.ip.replace("::ffff:", "");
    if (BOT_IP_WHITELIST.includes(ip)) return next();
    return globalLimiter(req, res, next);
});

// =======================
// 🔥 PROXY BOT (NO FP NEEDED)
// =======================
app.get("/api/v1", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({
                status: false,
                message: "URL is required"
            });
        }

        console.log(chalk.magenta(`[PROXY] ${req.ip} -> ${url}`));

        const response = await axios.get(`${BASE_URL}/v1/api/convert`, {
            params: {
                url,
                fp: MASTER_FP
            },
            headers: {
                "X-Fingerprint": MASTER_FP
            },
            timeout: 15000
        });

        res.json(response.data);

    } catch (err) {
        console.error(chalk.red("🔥 Proxy Error:"), err.message);

        res.status(500).json({
            status: false,
            message: "Proxy error"
        });
    }
});

// =======================
// 🔐 FINGERPRINT CHECK
// =======================
app.use((req, res, next) => {
 if (req.path.startsWith("/api/v2")) return next();
    const fp = req.query.fp || req.headers["x-fingerprint"];

    if (!fp) {
        return res.status(401).json({
            status: false,
            message: "Fingerprint required"
        });
    }

    const isMaster = fp === MASTER_FP;
    const isBrowser = fp.length > 50;

    if (isMaster || isBrowser) return next();

    return res.status(403).json({
        status: false,
        message: "Invalid fingerprint"
    });
});

// =======================
// 🎬 CONVERT
// =======================
app.get("/v1/api/convert", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ status: false });

        const { data } = await axios.get(
            `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`
        );

        if (data.code !== 0) {
            return res.json({
                status: false,
                message: "Video not found"
            });
        }

        const vid = data.data;

        res.json({
            status: true,
            title: vid.title,
            cover: vid.cover,
            author: vid.author.nickname,
            download: {
                nowm: vid.play,
                wm: vid.wmplay,
                mp3: vid.music
            }
        });

    } catch (err) {
        console.log(err.message);
        res.status(500).json({ status: false });
    }
});

// =======================
// ⬇️ DOWNLOAD
// =======================
app.get("/v1/api/download", async (req, res) => {
    try {
        let { url, filename } = req.query;

        if (!url || !url.startsWith("http")) {
            return res.status(400).send("Invalid URL");
        }

        const response = await axios.get(url, {
            responseType: "stream"
        });

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename || "file"}"`
        );

        res.setHeader(
            "Content-Type",
            response.headers["content-type"] || "application/octet-stream"
        );

        response.data.pipe(res);

    } catch (err) {
        console.log("DOWNLOAD ERROR:", err.message);
        res.status(500).send("Error");
    }
});
// =======================
// 🎬 YT SHORTS (V2) - FIX MAPPING
// =======================
app.get("/api/v2/ytshorts", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ status: false, message: "URL is required" });

        console.log(chalk.cyan(`[YT SHORTS] ${req.ip} -> ${url}`));

        const { data } = await axios.get("https://api.ikyyxd.my.id/download/ytmp4", {
            params: { q: url },
            timeout: 20000
        });

        if (!data.status) return res.json({ status: false, message: "Video tidak ditemukan" });

        // PASTIKAN STRUKTUR RESULT TETAP SAMA SEPERTI API ASLINYA
        // Agar script HTML yang kita buat tadi tidak perlu diubah-ubah lagi
        res.json({
            status: true,
            creator: data.creator,
            result: data.result // Langsung kirim data.result asli dari API pusat
        });

    } catch (err) {
        console.log("YT SHORTS ERROR:", err.message);
        res.status(500).json({ status: false, message: "Server error" });
    }
});

// =======================
// ⬇️ DOWNLOAD V2 (YT)
// =======================
app.get("/api/v2/download", async (req, res) => {
    try {
        let { url, filename } = req.query;

        if (!url || !url.startsWith("http")) {
            return res.status(400).send("Invalid URL");
        }

        const response = await axios.get(url, {
            responseType: "stream"
        });

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename || "ytshorts.mp4"}"`
        );

        res.setHeader(
            "Content-Type",
            response.headers["content-type"] || "application/octet-stream"
        );

        response.data.pipe(res);

    } catch (err) {
        console.log("DOWNLOAD V2 ERROR:", err.message);
        res.status(500).send("Error");
    }
});

// =======================
export default app;
