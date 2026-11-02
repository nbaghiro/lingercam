Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '0.1.0'
  s.summary        = 'Starts, updates and ends the Linger Live Activity.'
  s.description    = 'Starts, updates and ends the Linger Live Activity.'
  s.license        = 'UNLICENSED'
  s.author         = 'GalleoApp, Inc.'
  s.homepage       = 'https://lingercam.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.frameworks = 'ActivityKit'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
