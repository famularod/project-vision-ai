Pod::Spec.new do |s|
  s.name           = 'DaveTextRecognition'
  s.version        = '1.0.0'
  s.summary        = 'Local screenshot text recognition for DAVE schedule intake.'
  s.description    = 'Uses Apple Vision to recognize text locally from schedule communication screenshots.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'DAVE' => 'local' }
  s.homepage       = 'https://github.com/famularod/project-vision-ai'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/famularod/project-vision-ai.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
