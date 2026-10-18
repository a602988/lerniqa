import { LearningBookSharePage } from "../../../components/learning-book-share-page";

export default async function SharedLearningBookPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <LearningBookSharePage token={token} />;
}
