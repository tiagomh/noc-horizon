# Frontend do NOC Horizon servido por Nginx sem privilégios de root
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html favicon.svg /usr/share/nginx/html/
COPY css  /usr/share/nginx/html/css
COPY js   /usr/share/nginx/html/js
COPY public /usr/share/nginx/html/public

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
