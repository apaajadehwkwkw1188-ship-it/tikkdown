import express from "express";
import axios from "axios";
import FormData from "form-data";
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
const CDN_UPLOAD = "https://cdnn.ikyyxd.my.id/api/upload.php";
const BLOCK_FILE = path.join("/tmp", "blocked-ips.json"); // ⚠️ vercel fix
const ALLOWED_DOWNLOAD_DOMAIN = "cdnn.ikyyxd.my.id";

const BOT_IP_WHITELIST = ["127.0.0.1", "::1"];
const MASTER_FP = "TW96aWxsYS81LjAgKExpbnV4OyBBbmRyb2lkIDEwOyBLKSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTM5LjAuMC4wIE1vYmlsZSBTYWZhcmkvNTM3LjM2MzYwQXNpYS9KYWthcnRh";
const BASE_URL = "https://tikkdown.my.id";

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
// 🔥 ROOT HTML
// =======================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =======================
// 🔥 API DOCS HTML
// =======================
app.get("/api", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "api-docs.html"));
});

// =======================
// 🔥 BLOCK CHECK
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
// 🔥 RATE LIMIT
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
// 🔥 PROXY API
// =======================
app.get("/api/v1", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ status: false });

        const response = await axios.get(`${BASE_URL}/v1/api/convert`, {
            params: {
                url,
                fp: MASTER_FP
            },
            headers: {
                "X-Fingerprint": MASTER_FP
            }
        });

        res.json(response.data);

    } catch (err) {
        console.log("PROXY ERROR:", err.message);
        res.status(500).json({ status: false });
    }
});

// =======================
// 🔐 FINGERPRINT CHECK
// =======================
app.use((req, res, next) => {
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
// 📤 CDN UPLOAD
// =======================
async function uploadToCDN(fileUrl, filename) {
    try {
        const fileRes = await axios.get(fileUrl, {
            responseType: "arraybuffer",
            timeout: 10000
        });

        const form = new FormData();
        form.append("file", fileRes.data, filename);

        const uploadRes = await axios.post(CDN_UPLOAD, form, {
            headers: form.getHeaders(),
            timeout: 15000
        });

        return uploadRes.data.url;
    } catch {
        return null;
    }
}

// =======================
// 🎬 CONVERT
// =======================
app.get("/v1/api/convert", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ status: false });

        const { data } = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (data.code !== 0) return res.json({ status: false });

        const vid = data.data;

        const [nowm, wm, mp3] = await Promise.all([
            uploadToCDN(vid.play, "nowm.mp4"),
            uploadToCDN(vid.wmplay, "wm.mp4"),
            uploadToCDN(vid.music, "audio.mp3")
        ]);

        res.json({
            status: true,
            title: vid.title,
            cover: vid.cover,
            author: vid.author.nickname,
            download: { nowm, wm, mp3 }
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

        if (!url || !url.includes(ALLOWED_DOWNLOAD_DOMAIN)) {
            return res.status(403).send("Forbidden");
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

    } catch {
        res.status(500).send("Error");
    }
});

// =======================
export default app;
