{{- define "tracemark.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "tracemark.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels for one component: pass (dict "ctx" $ "component" "app"). */}}
{{- define "tracemark.selector" -}}
app.kubernetes.io/name: {{ .ctx.Chart.Name }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "tracemark.secretName" -}}
{{- default (include "tracemark.fullname" .) .Values.existingSecret -}}
{{- end -}}

{{- define "tracemark.clickhouseSecretName" -}}
{{- default (include "tracemark.fullname" .) .Values.clickhouse.existingSecret -}}
{{- end -}}

{{- define "tracemark.clickhouseUrl" -}}
{{- if .Values.clickhouse.enabled -}}
http://{{ include "tracemark.fullname" . }}-clickhouse:8123
{{- else -}}
{{- required "clickhouse.external.url is required when clickhouse.enabled is false" .Values.clickhouse.external.url -}}
{{- end -}}
{{- end -}}

{{- define "tracemark.image" -}}
{{- printf "%s:%s" .image.repository (default .ctx.Chart.AppVersion .image.tag) -}}
{{- end -}}

{{/* ClickHouse connection settings shared by the app and ingest. */}}
{{- define "tracemark.clickhouseEnv" -}}
- name: CLICKHOUSE_URL
  value: {{ include "tracemark.clickhouseUrl" . | quote }}
- name: CLICKHOUSE_USER
  value: {{ .Values.clickhouse.user | quote }}
- name: CLICKHOUSE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "tracemark.clickhouseSecretName" . }}
      key: CLICKHOUSE_PASSWORD
- name: CLICKHOUSE_DATABASE
  value: {{ .Values.clickhouse.database | quote }}
- name: INTERNAL_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "tracemark.secretName" . }}
      key: INTERNAL_TOKEN
{{- end -}}
