export async function onRequestPost(context) {
  const { request, env } = context;

  const formData = await request.formData();
  const file = formData.get('image');

  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    return Response.json({ error: 'Solo se permiten JPG, JPEG y PNG' }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: 'La imagen no puede superar 5MB' }, { status: 400 });
  }

  const extension = file.name.split('.').pop().toLowerCase();
  const filename = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

  await env.R2_BUCKET.put(filename, file.stream(), {
    httpMetadata: { contentType: file.type }
  });

  const publicUrl = `https://pub-3b710dc6aa284c00ad064e7d843a0c3c.r2.dev/${filename}`;
  return Response.json({ url: publicUrl, filename });
}
