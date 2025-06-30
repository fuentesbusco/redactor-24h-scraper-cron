import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import crypto from "crypto";
import mysql from "mysql2/promise";
// Cheerio no es necesario para el contenido, ya que viene como texto.

// --- Configuración para SoyChile ---
const SOURCE_ID_SOYCHILE = 11; // Asigna un ID único para esta fuente
const PAGE_SIZE = 20;
const TOTAL_PAGES = 5; // Total de páginas a scrapear
const DELAY_MS = 800;

let db;

/**
 * Limpia el texto del contenido, eliminando placeholders como {relacionada=...}
 * @param {string} text - El contenido en texto plano del artículo.
 * @returns {string} - El texto limpio.
 */
function cleanContent(text) {
  if (!text) return "";
  // Usa una expresión regular para eliminar cualquier cosa entre {}
  return text.replace(/\{[^}]+\}/g, "").trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Obtiene los artículos de la API de SoyChile.
 * @param {number} size - Cantidad de artículos por página.
 * @param {number} from - El punto de partida para la paginación (offset).
 * @returns {Promise<Array>} - Un array de artículos.
 */
async function fetchArticles(size = 10, from = 0) {
  // La paginación funciona con 'size' (cuántos) y 'from' (desde cuál)
  const url = `https://newsapi.ecn.cl/NewsApi/grm/buscar?q=&size=${size}&from=${from}`;

  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    referer: "https://soychile.cl/",
  };

  const response = await axios.get(url, { headers });
  // Los artículos están dentro de response.data.hits.hits
  return response.data?.hits?.hits || [];
}

/**
 * Guarda un artículo en la base de datos.
 * @param {object} article - El objeto del artículo de la API de SoyChile.
 */
async function saveArticle(article) {
  const source = article._source; // Todos los datos están dentro de _source
  const hash = generateHash(source.permalink);

  // Mapeo de campos desde la estructura de SoyChile
  const title = source.titulo;
  const description = source.bajada?.[0]?.texto || "";
  const author = source.autor || "SoyChile";
  const section = source.seccion || "General";
  const tags = source.temas?.map((t) => t.nombre.replace("#tema#", "")) || [];
  const content = cleanContent(source.texto);
  const imageUrl = source.tablas?.tablaMedios?.[0]?.Url || null;
  const url = source.permalink;
  const published_at = new Date(source.fechaPublicacion);

  //   console.log([
  //     SOURCE_ID_SOYCHILE,
  //     title,
  //     description,
  //     author,
  //     section,
  //     JSON.stringify(tags),
  //     content,
  //     imageUrl,
  //     url,
  //     published_at,
  //     hash,
  //   ]);

  try {
    await db.execute(
      `INSERT INTO scraped_articles
          (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        SOURCE_ID_SOYCHILE,
        title,
        description,
        author,
        section,
        JSON.stringify(tags),
        content,
        imageUrl,
        url,
        published_at,
        hash,
      ]
    );
    console.log(`✅ Guardado: ${title}`);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.log(`⚠️ Duplicado (hash): ${url}`);
    } else {
      console.error(`❌ Error al guardar: ${err.message}`);
    }
  }
}

async function runSoyChileScraper() {
  console.log(`🔄 Iniciando scraper de SoyChile...`);
  let newsCount = 0;
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    for (let page = 0; page < TOTAL_PAGES; page++) {
      const from = page * PAGE_SIZE;
      console.log(
        `📥 Procesando página ${page + 1} (desde el artículo ${from})`
      );

      const articles = await fetchArticles(PAGE_SIZE, from);

      if (articles.length === 0) {
        console.log("No se encontraron más artículos. Terminando.");
        break;
      }

      for (const article of articles) {
        try {
          await saveArticle(article);
          console.log(`  Guardado: ${article._source.titulo}`);
          newsCount++;
        } catch (err) {
          if (err.code !== "ER_DUP_ENTRY") {
            console.error(
              `  ❌ Error al guardar "${article._source.titulo}":`,
              err.message
            );
          } else {
            console.log(`  -> Omitido (duplicado): ${article._source.titulo}`);
          }
        }
      }
      await delay(DELAY_MS);
    }
  } catch (err) {
    console.error("❌ Error fatal en el scraper de SoyChile:", err.message);
  } finally {
    if (db) await db.end();
    console.log(
      `✅ Scraper de SoyChile finalizado. Noticias procesadas: ${newsCount}`
    );
  }

  return newsCount;
}

export default runSoyChileScraper;
