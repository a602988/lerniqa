import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    async rewrites() {
        return [
            {
                source: "/:path(overview|practice|questions|bank|mistakes|results|settings)",
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
                source: "/practice/schedules",
                destination: "/",
            },
            {
                source: "/settings/exams/:examId",
                destination: "/",
            },
            {
                source: "/:path(login|register|logout|forgot-password|quick-register|account-link)",
                destination: "/",
            },
        ];
    },
};

export default nextConfig;
