import Script from "next/script"

export function PaddleScript() {
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  if (!clientToken) return null

  const isSandbox = process.env.NODE_ENV !== "production"

  return (
    <>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="afterInteractive"
      />
      <Script id="paddle-init" strategy="afterInteractive">
        {`
          if (typeof window !== 'undefined' && window.Paddle) {
            ${isSandbox ? `Paddle.Environment.set("sandbox");` : ""}
            Paddle.Initialize({ token: "${clientToken}" });
          }
        `}
      </Script>
    </>
  )
}
