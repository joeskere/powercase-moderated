# powercase-moderated

App para gestionar publicaciones moderadas de MercadoLibre México con cruce de stock Zomatik.

## Stack
- **Backend:** Vercel (Node.js serverless)
- **Storage:** Vercel Blob (tokens OAuth)
- **Frontend:** GitHub Pages (HTML/JS estático)

## Deploy

### 1. Crear app en ML Developers
1. Ir a https://developers.mercadolibre.com.mx
2. Crear nueva app
3. En "URI de redirección": `https://powercase-moderated.vercel.app/api/auth/callback`
4. Guardar **App ID** y **Secret Key**

### 2. Deploy backend en Vercel
```bash
git init
git add .
git commit -m "init"
# Crear repo en GitHub: joeskere/powercase-moderated
git remote add origin https://github.com/joeskere/powercase-moderated.git
git push -u origin main
# Importar en vercel.com → New Project
```

### 3. Variables de entorno en Vercel
```
ML_APP_ID=tu_app_id
ML_SECRET=tu_secret_key
REDIRECT_URI=https://powercase-moderated.vercel.app/api/auth/callback
BLOB_READ_WRITE_TOKEN=  ← se genera en Vercel Storage → Blob
```

### 4. Crear Vercel Blob
En el dashboard de Vercel → tu proyecto → Storage → Create Blob Store
Copiar el token BLOB_READ_WRITE_TOKEN a las env vars.

### 5. Deploy frontend en GitHub Pages
- Subir `public/index.html` a la rama `gh-pages` o configurar Pages desde `/public`
- O simplemente abrir `index.html` localmente — funciona desde cualquier origen

## Uso
1. Abrir la app → Paso 1: Conectar ML (OAuth)
2. Paso 2: Subir Excel de Zomatik (columna "Codigo Sistema" + columna stock)
3. Click "Buscar publicaciones moderadas"
4. La tabla muestra solo las moderadas, cruzadas con stock
5. Click "Apelar →" en cada item abre el formulario de apelación de ML

## Estructura del Excel esperado
| Codigo Sistema | Stock | (otras columnas...) |
|----------------|-------|---------------------|
| ABC123         | 5     | ...                 |
| DEF456         | 0     | ...                 |

La columna de stock puede llamarse: "Stock", "Cantidad", "Disponible" (case-insensitive).
