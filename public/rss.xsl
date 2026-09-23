<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/rss/channel">
    <html lang="es">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="title"/></title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box }
          body {
            background: #07060c;
            color: #f6f5f8;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            -webkit-font-smoothing: antialiased;
            padding: 48px 20px 80px;
          }
          .wrap { max-width: 760px; margin: 0 auto }
          .note {
            font-family: Consolas, monospace;
            font-size: .72rem;
            color: #a29cb3;
            border: 1px solid rgba(139,92,246,.35);
            background: linear-gradient(160deg, rgba(139,92,246,.1), rgba(34,211,238,.05));
            border-radius: 12px;
            padding: 14px 18px;
            line-height: 1.7;
            margin-bottom: 34px;
          }
          .note b { color: #22d3ee }
          h1 {
            font-size: 1.9rem;
            font-weight: 700;
            letter-spacing: -.01em;
            margin-bottom: 10px;
          }
          h1 span {
            background: linear-gradient(135deg, #8b5cf6, #22d3ee);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
          }
          .sub { color: #a29cb3; font-size: .95rem; line-height: 1.7; margin-bottom: 18px }
          .links { display: flex; gap: 18px; margin-bottom: 36px }
          .links a {
            font-family: Consolas, monospace;
            font-size: .74rem;
            color: #22d3ee;
            text-decoration: none;
            border-bottom: 1px solid rgba(34,211,238,.35);
            padding-bottom: 2px;
          }
          article {
            border: 1px solid rgba(255,255,255,.08);
            background: linear-gradient(160deg, #171321, #110e1a);
            border-radius: 14px;
            padding: 22px 24px;
            margin-bottom: 14px;
          }
          article h2 { font-size: 1.05rem; margin-bottom: 8px; line-height: 1.4 }
          article h2 a { color: #f6f5f8; text-decoration: none }
          article h2 a:hover { color: #22d3ee }
          article time {
            font-family: Consolas, monospace;
            font-size: .64rem;
            letter-spacing: .1em;
            text-transform: uppercase;
            color: #645f74;
            display: block;
            margin-bottom: 10px;
          }
          article p { color: #a29cb3; font-size: .88rem; line-height: 1.7 }
          footer {
            margin-top: 40px;
            padding-top: 22px;
            border-top: 1px solid rgba(255,255,255,.07);
            font-family: Consolas, monospace;
            font-size: .68rem;
            color: #645f74;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="note">
            Esto es un <b>feed RSS</b> (XML). Pegá la URL <b>pixelarch.dev/rss.xml</b> en tu lector de feeds
            (Feedly, Inoreader) o en una automatización para recibir los artículos nuevos automáticamente.
          </div>

          <h1>Blog <span>PixelArch</span></h1>
          <p class="sub"><xsl:value-of select="description"/></p>
          <div class="links">
            <a href="https://pixelarch.dev/blog">← Ir al blog</a>
            <a href="https://pixelarch.dev">pixelarch.dev</a>
          </div>

          <xsl:for-each select="item">
            <article>
              <h2><a href="{link}"><xsl:value-of select="title"/></a></h2>
              <time><xsl:value-of select="pubDate"/></time>
              <p><xsl:value-of select="description"/></p>
            </article>
          </xsl:for-each>

          <footer>
            PixelArch · Feed RSS 2.0 · pixelarch.dev/rss.xml
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
