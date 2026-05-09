# GitLab CE configuration for local PoC environment
external_url 'http://localhost:8080'

# Disable email — no SMTP configured in local dev
gitlab_rails['gitlab_email_enabled'] = false

# Tune workers to reduce memory usage on a local machine
puma['worker_processes'] = 2
sidekiq['max_concurrency'] = 10

# Inject the Copilot chat widget into every GitLab page.
# sub_filter replaces </head> with a <script> tag + </head> before sending the
# HTML to the browser. proxy_set_header ensures Puma sends uncompressed HTML
# so that the sub_filter module can process the response body.
nginx['custom_gitlab_server_config'] = <<~NGINX
  sub_filter_types text/html;
  sub_filter '</head>' '<script src="http://localhost:3000/widget.js" defer></script></head>';
  sub_filter_once on;
  proxy_set_header Accept-Encoding "";
NGINX
