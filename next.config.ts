import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Keep the long-running local site isolated from validation builds. Next
    // dev and next build mutate their output directory and cannot safely share
    // it while the browser is using compiled chunks.
    distDir: process.env.LERNIQA_NEXT_DIST_DIR ?? ".next",
    async redirects() {
        return [
            { source: "/local-practice", destination: "/practice", permanent: false },
            { source: "/forgot-password", destination: "/account/forgot-password", permanent: false },
            { source: "/account-link", destination: "/account", permanent: false },
        ];
    },
    async headers() {
        return [
            {
                source: "/admin/:path*",
                headers: [
                    {
                        key: "Content-Security-Policy",
                        value: "frame-ancestors 'none'",
                    },
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "Referrer-Policy", value: "no-referrer" },
                ],
            },
        ];
    },
    async rewrites() {
        return [
            {
                source: "/:path(overview|practice|questions|bank|mistakes|results|settings|system-settings)",
                destination: "/",
            },
            {
                source: "/practice/session",
                destination: "/",
            },
            {
                source: "/practice/session/:questionId",
                destination: "/",
            },
            {
                source: "/questions/:questionId",
                destination: "/",
            },
            {
                source: "/practice/schedules",
                destination: "/",
            },
            {
                source: "/settings/exams/:examId",
                destination: "/",
            },
            {
                source: "/:path(login|register)",
                destination: "/",
            },
        ];
    },
};

export default nextConfig;
