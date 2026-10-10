FROM php:8.2-apache

RUN printf '%s\n' \
    '<VirtualHost *:80>' \
    '    DocumentRoot /var/www/html' \
    '    <Directory /var/www/html>' \
    '        AllowOverride None' \
    '        Require all granted' \
    '        DirectoryIndex index.php' \
    '        DirectorySlash Off' \
    '        RewriteEngine On' \
    '        RewriteCond %{REQUEST_FILENAME} !-f' \
    '        RewriteRule ^ /index.php [L]' \
    '    </Directory>' \
    '</VirtualHost>' \
    > /etc/apache2/sites-available/000-default.conf \
    && a2enmod rewrite

COPY public/ /var/www/html/

EXPOSE 80
