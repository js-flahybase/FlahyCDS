import './globals.css';

export const metadata = {
  title: 'FlahyCDS',
  description: 'Copied Next.js app for Azure Blob Storage'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="text-ink">{children}</body>
    </html>
  );
}
